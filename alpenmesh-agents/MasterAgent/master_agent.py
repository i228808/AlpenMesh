"""
master_agent.py — Backward-compatibility shim.

The RuleBasedMasterAgent class has moved to agents/rule_based.py.
This file re-exports it so that:
  - sumo_runner.py  `from master_agent import RuleBasedMasterAgent` still works
  - The FastAPI app is now in services/api.py but this file also hosts it for
    single-process dev/sumo mode: `uvicorn master_agent:app`
"""
import os
import sys
import time
import subprocess
from typing import Dict, Any

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

# Re-export so `from master_agent import RuleBasedMasterAgent` keeps working
from agents.rule_based import RuleBasedMasterAgent  # noqa: F401
from agents import load as _load_agent
# Re-export CorridorManager at module scope — legacy tests patch
# ``master_agent.CorridorManager.from_yaml`` to stub the corridor layer.
from corridor import CorridorManager  # noqa: F401
from db import decisions_col

# ==========================
#  FastAPI App (legacy single-process mode)
# ==========================

app = FastAPI(title="AlpenMesh Master Agent", version="3.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

_impl = os.getenv("MASTER_AGENT_IMPL", "rule_based")
agent = _load_agent(_impl)

latest_sumo_metrics: Dict[str, Any] = {}
sumo_process = None


@app.get("/health")
async def health():
    info: Dict[str, Any] = {"status": "ok", "time": time.time(), "impl": _impl}
    if hasattr(agent, "_corridor_mgr"):
        info["corridors"] = agent._corridor_mgr.corridor_summary()
        info["active_platoon_events"] = agent._corridor_mgr.n_active_events
    return info


@app.get("/api/status")
async def get_status():
    result: Dict[str, Any] = {"time": time.time(), "impl": _impl}
    if hasattr(agent, "active_overrides"):
        result["active_overrides"] = agent.active_overrides
    if hasattr(agent, "_tier2_staging"):
        result["tier2_staging"] = {k: {"score_up": v["score_up"], "score_down": v["score_down"]}
                                   for k, v in agent._tier2_staging.items()}
    if hasattr(agent, "_corridor_mgr"):
        result["platoon_events"] = agent._corridor_mgr.active_events()
        result["corridors"] = agent._corridor_mgr.corridor_summary()
    return result


@app.get("/api/metrics")
async def get_metrics():
    try:
        pipeline = [
            {"$sort": {"created_at": -1}},
            {"$group": {"_id": "$metrics.camera_name", "latest_metric": {"$first": "$$ROOT"}}},
        ]
        results = list(decisions_col.aggregate(pipeline))
        cleaned = []
        for r in results:
            full_doc = r["latest_metric"]
            flat_doc = full_doc.get("metrics", {}).copy()
            flat_doc["decision"] = full_doc.get("decision")
            flat_doc["last_updated"] = full_doc.get("created_at")
            cleaned.append(flat_doc)
        return cleaned
    except Exception as e:
        return JSONResponse(status_code=500, content={"error": str(e)})


@app.get("/api/sumo-metrics")
@app.post("/api/sumo-metrics")
async def sumo_metrics(request: Request):
    global latest_sumo_metrics
    if request.method == "POST":
        try:
            data = await request.json()
            if data:
                latest_sumo_metrics = data
                latest_sumo_metrics["last_updated"] = time.time()
        except Exception:
            pass
        return {"status": "received"}
    return latest_sumo_metrics


@app.post("/api/simulation/start")
async def start_simulation():
    global sumo_process
    if sumo_process and sumo_process.poll() is None:
        return {"status": "already_running", "pid": sumo_process.pid}
    try:
        current_dir = os.path.dirname(os.path.abspath(__file__))
        script_path = os.path.join(current_dir, "sumo_runner.py")
        sumo_process = subprocess.Popen([sys.executable, script_path], cwd=current_dir)
        return {"status": "started", "pid": sumo_process.pid}
    except Exception as e:
        return JSONResponse(status_code=500, content={"error": str(e)})


@app.post("/api/simulation/stop")
async def stop_simulation():
    global sumo_process
    if not sumo_process:
        return {"status": "not_running"}
    try:
        sumo_process.terminate()
        try:
            sumo_process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            sumo_process.kill()
        sumo_process = None
        return {"status": "stopped"}
    except Exception as e:
        return JSONResponse(status_code=500, content={"error": str(e)})


@app.get("/api/simulation/status")
async def simulation_status():
    global sumo_process
    is_running = (sumo_process is not None) and (sumo_process.poll() is None)
    return {"running": is_running, "pid": sumo_process.pid if is_running else None}


@app.post("/api/override")
async def set_override(request: Request):
    try:
        data = await request.json()
    except Exception:
        return JSONResponse(status_code=400, content={"error": "Invalid JSON"})
    if not data:
        return JSONResponse(status_code=400, content={"error": "Invalid JSON"})

    camera_name = data.get("camera_name")
    action = data.get("action")
    target_roi = data.get("target_roi")
    duration = data.get("duration", 60)

    if not camera_name or not action:
        return JSONResponse(status_code=400, content={"error": "Missing camera_name or action"})

    if action == "AUTO":
        agent.clear_override(camera_name)
        return {"status": "cleared", "camera": camera_name}
    else:
        agent.set_override(camera_name, action, target_roi, duration)
        return {"status": "set", "camera": camera_name, "action": action}


@app.post("/decision")
async def decision(request: Request):
    """Edge Agent POSTs metrics here. Returns advisory action."""
    try:
        data = await request.json()
    except Exception:
        return JSONResponse(status_code=400, content={"error": "Invalid or empty JSON"})
    if not data:
        return JSONResponse(status_code=400, content={"error": "Invalid or empty JSON"})

    state_before = {}
    camera_name = data.get("camera_name", "Unknown")
    if hasattr(agent, "_get_inter_state"):
        inter_state = agent._get_inter_state(camera_name)
        state_before = {
            "current_phase_axis": inter_state.get("current_phase_axis"),
            "phase_elapsed_s": round(time.time() - inter_state.get("phase_start_time", time.time()), 1),
            "last_green_time_UP": inter_state.get("last_green_time_UP"),
            "last_green_time_DOWN": inter_state.get("last_green_time_DOWN"),
        }

    decision_result = agent.decide(data)

    try:
        decisions_col.insert_one({
            "metrics": data,
            "state_before": state_before,
            "decision": decision_result,
            "created_at": time.time(),
            "impl": _impl,
            "outcome": None,
            "outcome_recorded_at": None,
        })
    except Exception as e:
        print(f"[WARN] Failed to log decision: {e}")

    return decision_result


@app.get("/api/corridors/events")
async def corridor_events():
    if hasattr(agent, "_corridor_mgr"):
        return {
            "active_events": agent._corridor_mgr.active_events(),
            "corridors": agent._corridor_mgr.corridor_summary(),
        }
    return {"active_events": [], "corridors": []}


if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("FASTAPI_PORT", "8080"))
    uvicorn.run("master_agent:app", host="0.0.0.0", port=port, reload=False)
