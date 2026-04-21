"""
services/api.py — FastAPI gateway for the MasterAgent.

Endpoints
─────────
Legacy / core
  POST /decision            sync decide (sumo_runner, EdgeAgent direct call)
  GET  /health
  GET  /api/status          includes active_overrides for operator-control

Operator-control dashboard
  GET  /api/metrics         per-camera live state (dashboard polls 2s)
  POST /api/override        FORCE_GREEN | FORCE_RED | SWITCH_GREEN | SWITCH_RED | AUTO
  GET  /api/sumo-metrics    simulation KPIs (avg_wait, total_queue, throughput)

SUMO simulation lifecycle
  GET  /api/simulation/status
  POST /api/simulation/start
  POST /api/simulation/stop

Data / RL
  GET  /api/decisions       recent decisions from Mongo (paginated)
  GET  /api/metrics/latest  latest raw metrics per camera from Mongo
  GET  /api/live            low-latency Redis snapshot of intersection state
  GET  /api/experience      RL experience buffer

Incident webhooks (from ReportingAgent)
  POST /incidents/{kind}

Observability
  GET  /metrics             Prometheus
"""
import csv
import json
import os
import subprocess
import sys
import time
from pathlib import Path
from typing import Any, Dict, List, Optional

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response

try:
    import redis as redis_lib
    HAS_REDIS = True
except ImportError:
    HAS_REDIS = False

try:
    from prometheus_client import generate_latest, CONTENT_TYPE_LATEST
    HAS_PROMETHEUS = True
except ImportError:
    HAS_PROMETHEUS = False

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from agents import load as load_agent
from db import decisions_col, experience_col, metrics_col
from topology.roi_adapter import RoiMapper
from services.incident_handler import router as incident_router, init as init_incidents

REDIS_URL  = os.getenv("REDIS_URL", "redis://localhost:6379/0")
AGENT_IMPL = os.getenv("MASTER_AGENT_IMPL", "rule_based")
MASTER_DIR = Path(__file__).resolve().parent.parent

# Redis key prefix for operator overrides
_OVERRIDE_PREFIX = "override:"
_OVERRIDE_TTL    = 3600  # 1 hour safety cap

app = FastAPI(title="AlpenMesh Master Agent API", version="3.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Shared state ──────────────────────────────────────────────────────────────
agent = load_agent(AGENT_IMPL)
_redis: Optional["redis_lib.Redis"] = None
if HAS_REDIS:
    try:
        _redis = redis_lib.Redis.from_url(REDIS_URL, decode_responses=True)
        _redis.ping()
    except Exception:
        _redis = None

roi_mapper = RoiMapper(str(MASTER_DIR / "topology" / "roi_mapping.yaml"))
init_incidents(roi_mapper, _redis)
app.include_router(incident_router)

# SUMO subprocess handle (single process, managed by this API instance)
_sumo_proc: Optional[subprocess.Popen] = None


# ── Helpers ───────────────────────────────────────────────────────────────────

def _get_active_overrides() -> Dict[str, Any]:
    """Return {camera_name: {action, target_roi, expires_at}} for all live overrides."""
    if not _redis:
        return {}
    try:
        keys = _redis.keys(f"{_OVERRIDE_PREFIX}*")
        out: Dict[str, Any] = {}
        now = time.time()
        for key in keys:
            raw = _redis.get(key)
            if not raw:
                continue
            try:
                data = json.loads(raw)
            except (json.JSONDecodeError, TypeError):
                continue
            if data.get("expires_at", 0) < now:
                _redis.delete(key)
                continue
            cam = key[len(_OVERRIDE_PREFIX):]
            out[cam] = data
        return out
    except Exception:
        return {}


def _latest_sumo_metrics() -> Dict[str, Any]:
    """Read the most recent row from any panel CSV for live SUMO KPIs."""
    results_dir = MASTER_DIR / "results"
    best_mtime = 0.0
    best_path: Optional[Path] = None
    for p in results_dir.glob("*.csv"):
        if p.stat().st_mtime > best_mtime:
            best_mtime = p.stat().st_mtime
            best_path = p
    if best_path is None:
        return {"avg_wait_time": 0, "total_queue": 0, "throughput": 0}
    try:
        with open(best_path, newline="") as f:
            rows = list(csv.DictReader(f))
        if not rows:
            return {"avg_wait_time": 0, "total_queue": 0, "throughput": 0}
        last = rows[-1]
        return {
            "avg_wait_time": round(float(last.get("avg_wait_time", 0) or 0), 2),
            "total_queue":   int(float(last.get("total_queue", 0) or 0)),
            "throughput":    int(float(last.get("throughput", 0) or 0)),
        }
    except Exception:
        return {"avg_wait_time": 0, "total_queue": 0, "throughput": 0}


# ── Core endpoints ────────────────────────────────────────────────────────────

@app.get("/health")
async def health():
    return {
        "status": "ok",
        "time": time.time(),
        "impl": AGENT_IMPL,
        "redis": _redis is not None,
    }


@app.post("/decision")
async def decision(request: Request):
    """Legacy sync endpoint: sumo_runner or EdgeAgent POSTs metrics, gets decision."""
    try:
        data = await request.json()
    except Exception:
        return JSONResponse(status_code=400, content={"error": "Invalid JSON"})
    if not data:
        return JSONResponse(status_code=400, content={"error": "Empty payload"})

    # Respect active override for this camera
    cam = data.get("camera_name", "")
    if _redis and cam:
        raw = _redis.get(f"{_OVERRIDE_PREFIX}{cam}")
        if raw:
            try:
                ov = json.loads(raw)
                if ov.get("expires_at", 0) > time.time():
                    return {
                        "action": ov["action"],
                        "target_roi": ov.get("target_roi"),
                        "reason": f"operator override: {ov['action']}",
                        "override": True,
                    }
            except (json.JSONDecodeError, TypeError, KeyError):
                pass

    t0 = time.time()
    decision_result = agent.decide(data)
    decision_result["decision_time_ms"] = round((time.time() - t0) * 1000, 1)

    try:
        decisions_col.insert_one({
            "metrics": data,
            "decision": decision_result,
            "created_at": time.time(),
            "impl": AGENT_IMPL,
            "outcome": None,
            "outcome_recorded_at": None,
        })
    except Exception:
        pass

    return decision_result


# ── Operator-control dashboard ────────────────────────────────────────────────

@app.get("/api/metrics")
async def get_metrics():
    """
    Per-camera live state for the operator-control dashboard (polled every 2s).
    Sources: Redis feat keys (live) → MongoDB fallback.
    """
    cameras: Dict[str, Dict[str, Any]] = {}

    # Build from Redis feat keys
    if _redis:
        try:
            keys = _redis.keys("feat:*:*:through")
            for key in keys[:300]:
                parts = key.split(":")
                if len(parts) < 4:
                    continue
                intersection = parts[1]
                approach = parts[2]
                data = _redis.hgetall(key)
                if not data:
                    continue
                cam_name = data.get("camera_name", intersection)
                if cam_name not in cameras:
                    cameras[cam_name] = {
                        "camera_name": cam_name,
                        "total_vehicles": 0,
                        "vehicle_counts": {},
                        "congestion_levels": {},
                        "decision": None,
                    }
                try:
                    vc = int(float(data.get("vehicle_count", 0)))
                except (ValueError, TypeError):
                    vc = 0
                cameras[cam_name]["vehicle_counts"][approach] = vc
                cameras[cam_name]["total_vehicles"] = int(float(data.get("total_vehicles", 0) or 0))
                cameras[cam_name]["congestion_levels"][approach] = data.get("congestion", "Low")

                # Attach latest decision if cached
                dec_raw = _redis.get(f"last_decision:{intersection}")
                if dec_raw:
                    try:
                        cameras[cam_name]["decision"] = json.loads(dec_raw)
                    except (json.JSONDecodeError, TypeError):
                        pass
        except Exception:
            pass

    # Fallback 1: recent master_decisions (populated by sumo_runner via /decision)
    if not cameras:
        try:
            cutoff = time.time() - 30
            pipeline: List[Any] = [
                {"$match": {"created_at": {"$gte": cutoff}}},
                {"$sort": {"created_at": -1}},
                {"$group": {"_id": "$decision.intersection_id", "doc": {"$first": "$$ROOT"}}},
                {"$replaceRoot": {"newRoot": "$doc"}},
                {"$limit": 100},
            ]
            for doc in decisions_col.aggregate(pipeline):
                m = doc.get("metrics", {})
                cam_name = m.get("camera_name", doc.get("decision", {}).get("intersection_id", "unknown"))
                cameras[cam_name] = {
                    "camera_name": cam_name,
                    "total_vehicles": m.get("total_vehicles", 0),
                    "vehicle_counts": m.get("vehicle_counts", {}),
                    "congestion_levels": {
                        k: ("High" if v > 15 else "Medium" if v > 5 else "Low")
                        for k, v in (m.get("vehicle_counts") or {}).items()
                    },
                    "decision": doc.get("decision"),
                }
        except Exception:
            pass

    # Fallback 2: raw traffic_metrics collection (live edge agent path)
    if not cameras:
        try:
            pipeline = [
                {"$sort": {"timestamp": -1}},
                {"$group": {"_id": "$camera_name", "doc": {"$first": "$$ROOT"}}},
                {"$replaceRoot": {"newRoot": "$doc"}},
                {"$project": {"_id": 0}},
                {"$limit": 100},
            ]
            for doc in metrics_col.aggregate(pipeline):
                cam_name = doc.get("camera_name", "unknown")
                cameras[cam_name] = {
                    "camera_name": cam_name,
                    "total_vehicles": doc.get("total_vehicles", 0),
                    "vehicle_counts": doc.get("vehicle_counts", {}),
                    "congestion_levels": doc.get("congestion_levels", {}),
                    "decision": None,
                }
        except Exception:
            pass

    return list(cameras.values())


@app.post("/api/override")
async def set_override(request: Request):
    """
    Apply or clear a manual signal override.
    Body: { camera_name, action, target_roi?, duration? }
    action: FORCE_GREEN | FORCE_RED | SWITCH_GREEN | SWITCH_RED | AUTO
    """
    try:
        body = await request.json()
    except Exception:
        return JSONResponse(status_code=400, content={"error": "Invalid JSON"})

    cam    = body.get("camera_name", "").strip()
    action = body.get("action", "").upper().strip()
    if not cam or not action:
        return JSONResponse(status_code=400, content={"error": "camera_name and action required"})

    key = f"{_OVERRIDE_PREFIX}{cam}"

    if action == "AUTO":
        # Clear override — restore AI control
        if _redis:
            _redis.delete(key)
        return {"status": "cleared", "camera_name": cam}

    if action not in {"FORCE_GREEN", "FORCE_RED", "SWITCH_GREEN", "SWITCH_RED"}:
        return JSONResponse(status_code=400, content={"error": f"Unknown action: {action}"})

    duration = int(body.get("duration", 300))
    duration = max(10, min(duration, _OVERRIDE_TTL))

    override = {
        "action": action,
        "target_roi": body.get("target_roi"),
        "duration": duration,
        "set_at": time.time(),
        "expires_at": time.time() + duration,
    }

    if _redis:
        _redis.set(key, json.dumps(override), ex=duration)

    return {"status": "set", "camera_name": cam, "override": override}


@app.get("/api/sumo-metrics")
async def get_sumo_metrics():
    """Current simulation KPIs for the SumoControl page."""
    if _redis:
        raw = _redis.get("sumo:metrics")
        if raw:
            try:
                return json.loads(raw)
            except (json.JSONDecodeError, TypeError):
                pass
    return _latest_sumo_metrics()


@app.post("/api/sumo-metrics")
async def push_sumo_metrics(request: Request):
    """Called by sumo_runner.py each control cycle to push live KPIs."""
    try:
        body = await request.json()
    except Exception:
        return JSONResponse(status_code=400, content={"error": "Invalid JSON"})
    kpis = {
        "avg_wait_time": round(float(body.get("avg_wait_time", 0) or 0), 2),
        "total_queue":   int(float(body.get("total_queue",   0) or 0)),
        "throughput":    int(float(body.get("throughput",    body.get("total_arrived", 0)) or 0)),
        "sim_time":      round(float(body.get("sim_time", 0) or 0), 1),
        "updated_at":    time.time(),
    }
    if _redis:
        _redis.set("sumo:metrics", json.dumps(kpis), ex=120)
    return {"status": "ok"}


# ── SUMO simulation lifecycle ─────────────────────────────────────────────────

def _sumo_alive() -> bool:
    return _sumo_proc is not None and _sumo_proc.poll() is None


@app.get("/api/simulation/status")
async def simulation_status():
    alive = _sumo_alive()
    return {
        "running": alive,
        "pid": _sumo_proc.pid if alive else None,
    }


@app.post("/api/simulation/start")
async def simulation_start(request: Request):
    global _sumo_proc
    if _sumo_alive():
        return {"status": "already_running", "pid": _sumo_proc.pid}

    try:
        body = await request.json()
    except Exception:
        body = {}

    # Build environment for sumo_runner
    env = os.environ.copy()
    env.update({
        "SYNTHETIC_METRICS": str(body.get("synthetic_metrics", "0")),
        "SYNTHETIC_DEMAND":  str(body.get("synthetic_demand",  "0")),
        "DEMAND_PROFILE":    str(body.get("demand_profile",    "balanced")),
        "CONTROLLER_MODE":   str(body.get("controller_mode",   AGENT_IMPL)),
        "SIM_DURATION_S":    str(body.get("duration", 600)),
        "RANDOM_SEED":       str(body.get("seed", 42)),
        # HEADLESS intentionally omitted — sumo_runner defaults to sumo-gui
    })

    python_exe = sys.executable
    runner_path = str(MASTER_DIR / "sumo_runner.py")
    sim_log_path = str(MASTER_DIR / "logs" / "simulation.log")

    try:
        sim_log_fh = open(sim_log_path, "w")
        _sumo_proc = subprocess.Popen(
            [python_exe, runner_path],
            cwd=str(MASTER_DIR),
            env=env,
            stdout=sim_log_fh,
            stderr=sim_log_fh,
        )
        return {"status": "started", "pid": _sumo_proc.pid}
    except Exception as e:
        return JSONResponse(status_code=500, content={"status": "error", "error": str(e)})


@app.post("/api/simulation/stop")
async def simulation_stop():
    global _sumo_proc
    if not _sumo_alive():
        return {"status": "not_running"}
    try:
        _sumo_proc.terminate()
        try:
            _sumo_proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            _sumo_proc.kill()
        pid = _sumo_proc.pid
        _sumo_proc = None
        return {"status": "stopped", "pid": pid}
    except Exception as e:
        return JSONResponse(status_code=500, content={"status": "error", "error": str(e)})


# ── Data / RL endpoints ───────────────────────────────────────────────────────

@app.get("/api/decisions")
async def get_decisions(limit: int = 50, intersection_id: Optional[str] = None):
    """Recent master-agent decisions — paginated."""
    limit = min(max(limit, 1), 500)
    try:
        query: Dict[str, Any] = {}
        if intersection_id:
            query["decision.intersection_id"] = intersection_id
        docs = list(
            decisions_col.find(query, {"_id": 0, "metrics": 0})
            .sort("created_at", -1)
            .limit(limit)
        )
        return docs
    except Exception as e:
        return JSONResponse(status_code=500, content={"error": str(e)})


@app.get("/api/metrics/latest")
async def get_latest_metrics(intersection_id: Optional[str] = None):
    """Latest raw traffic metrics per camera from MongoDB."""
    try:
        pipeline: List[Any] = []
        if intersection_id:
            pipeline.append({"$match": {"camera_name": {"$regex": intersection_id, "$options": "i"}}})
        pipeline += [
            {"$sort": {"timestamp": -1}},
            {"$group": {"_id": "$camera_name", "doc": {"$first": "$$ROOT"}}},
            {"$replaceRoot": {"newRoot": "$doc"}},
            {"$project": {"_id": 0}},
            {"$limit": 100},
        ]
        return list(metrics_col.aggregate(pipeline))
    except Exception as e:
        return JSONResponse(status_code=500, content={"error": str(e)})


@app.get("/api/live")
async def get_live_state():
    """Low-latency Redis snapshot of all intersection approach states."""
    if not _redis:
        return JSONResponse(status_code=503, content={"error": "Redis unavailable"})
    try:
        keys = _redis.keys("feat:*:*:through")
        result: Dict[str, Any] = {}
        for key in keys[:200]:
            parts = key.split(":")
            if len(parts) < 4:
                continue
            intersection, approach = parts[1], parts[2]
            data = _redis.hgetall(key)
            if not data:
                continue
            result.setdefault(intersection, {})[approach] = {
                "occupancy":     float(data.get("occupancy", 0)),
                "vehicle_count": int(float(data.get("vehicle_count", 0))),
                "congestion":    data.get("congestion", "Low"),
                "stalled":       int(float(data.get("stalled_count", 0))),
                "ts":            float(data.get("ts", 0)),
            }
        return result
    except Exception as e:
        return JSONResponse(status_code=500, content={"error": str(e)})


@app.get("/api/status")
async def get_status():
    result: Dict[str, Any] = {
        "time": time.time(),
        "impl": AGENT_IMPL,
        "simulation_running": _sumo_alive(),
        "active_overrides": _get_active_overrides(),
    }
    if _redis:
        try:
            result["active_incidents"] = len(_redis.smembers("incidents:active"))
        except Exception:
            result["active_incidents"] = 0
    return result


@app.get("/api/experience")
async def get_experience(since: float = 0, limit: int = 100):
    """Experience buffer for RL training jobs."""
    limit = min(max(limit, 1), 10000)
    try:
        query = {"timestamp": {"$gte": since}} if since > 0 else {}
        docs = list(
            experience_col.find(query, {"_id": 0})
            .sort("timestamp", -1)
            .limit(limit)
        )
        return docs
    except Exception as e:
        return JSONResponse(status_code=500, content={"error": str(e)})


# ── Observability ─────────────────────────────────────────────────────────────

if HAS_PROMETHEUS:
    @app.get("/metrics")
    async def prometheus_metrics():
        return Response(content=generate_latest(), media_type=CONTENT_TYPE_LATEST)


if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("API_PORT", "8080"))
    uvicorn.run("services.api:app", host="0.0.0.0", port=port, reload=False)
