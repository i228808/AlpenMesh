"""
services/decision_worker.py — Redis pub/sub → decide → publish.

Subscribes to corridor update channels, loads features from Redis,
runs the decision pipeline (ModeSelector → MPC/MaxPressure → SafetyWrapper),
publishes decisions, and persists to Mongo.
"""
import os
import json
import time
import signal
import sys
from typing import Any, Dict, List, Optional

try:
    import redis
    HAS_REDIS = True
except ImportError:
    HAS_REDIS = False

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from agents import load as load_agent
from agents.mode_selector import ModeSelector
from db import decisions_col
from observability.logging import configure_logging, log

REDIS_URL     = os.getenv("REDIS_URL", "redis://localhost:6379/0")
AGENT_IMPL    = os.getenv("MASTER_AGENT_IMPL", "hybrid")

_running = True


def _sigterm_handler(signum, frame):
    global _running
    _running = False


def _load_features(r: "redis.Redis", intersection_id: str) -> Dict[str, Any]:
    """Load latest features for all approaches of an intersection from Redis."""
    features: Dict[str, Any] = {"camera_name": intersection_id, "vehicle_counts": {}, "traffic_metrics": {}}

    for approach in ("N", "S", "E", "W"):
        for movement in ("through", "left", "right"):
            key = f"feat:{intersection_id}:{approach}:{movement}"
            data = r.hgetall(key)
            if not data:
                continue

            roi_label = f"{approach}_{movement}"
            try:
                occ = float(data.get("occupancy", 0))
            except (ValueError, TypeError):
                occ = 0

            features["vehicle_counts"][roi_label] = int(occ)
            features["traffic_metrics"][roi_label] = {
                "occupancy": int(occ),
                "mean_dwell_sec": float(data.get("mean_dwell_sec", 0)),
                "stalled_count": int(float(data.get("stalled_count", 0))),
                "slow_throughput": int(float(data.get("slow_throughput", 0))),
                "arrival_rate": float(data.get("arrival_rate", 0)),
            }
            features["vehicle_counts"].setdefault("total", 0)
            features["vehicle_counts"]["total"] += int(occ)

    # Also load legacy UP/DOWN if present (for rule_based)
    for d in ("UP", "DOWN"):
        key = f"feat:{intersection_id}:{d[0]}:through"
        data = r.hgetall(key)
        if data:
            try:
                features["vehicle_counts"][d] = int(float(data.get("vehicle_count", data.get("occupancy", 0))))
            except (ValueError, TypeError):
                pass

    return features


def _check_incidents(r: "redis.Redis", intersection_id: str) -> List[Dict]:
    """Check for active incidents affecting this intersection."""
    active_keys = r.smembers("incidents:active")
    incidents = []
    now = time.time()
    for key in active_keys:
        data_raw = r.get(key)
        if not data_raw:
            r.srem("incidents:active", key)
            continue
        try:
            data = json.loads(data_raw)
        except (json.JSONDecodeError, TypeError):
            continue
        if data.get("expires_at", 0) < now:
            r.srem("incidents:active", key)
            r.delete(key)
            continue
        for a in data.get("approaches", []):
            if a.get("intersection_id") == intersection_id:
                incidents.append(data)
                break
    return incidents


def run():
    configure_logging()
    signal.signal(signal.SIGTERM, _sigterm_handler)

    if not HAS_REDIS:
        log.error("redis package not installed; decision_worker cannot start")
        sys.exit(1)

    r = redis.Redis.from_url(REDIS_URL, decode_responses=True)
    agent = load_agent(AGENT_IMPL)

    # Subscribe to all corridor update channels
    pubsub = r.pubsub()
    pubsub.psubscribe("updates:*")

    log.info("decision_worker starting", impl=AGENT_IMPL)

    for message in pubsub.listen():
        if not _running:
            break
        if message["type"] not in ("pmessage",):
            continue

        camera_name = message.get("data", "")
        if not camera_name or not isinstance(camera_name, str):
            continue

        try:
            _handle_update(r, agent, camera_name)
        except Exception as e:
            log.error("decision_error", camera=camera_name, error=str(e))

    pubsub.close()
    log.info("decision_worker stopped")


def _check_override(r: "redis.Redis", camera_name: str) -> Optional[dict]:
    """Return active operator override for this camera, or None."""
    raw = r.get(f"override:{camera_name}")
    if not raw:
        return None
    try:
        ov = json.loads(raw)
        if ov.get("expires_at", 0) > time.time():
            return ov
    except (json.JSONDecodeError, TypeError):
        pass
    return None


def _handle_update(r: "redis.Redis", agent, camera_name: str) -> None:
    from topology.roi_adapter import RoiMapper
    intersection_id = RoiMapper._camera_to_intersection(camera_name)

    # Honour operator override — skip AI decision entirely
    override = _check_override(r, camera_name)
    if override:
        decision = {
            "action": override["action"],
            "target_roi": override.get("target_roi"),
            "reason": f"operator override: {override['action']}",
            "override": True,
            "intersection_id": intersection_id,
        }
        r.publish(f"decisions:{intersection_id}", json.dumps(decision, default=str))
        r.set(f"last_decision:{intersection_id}", json.dumps(decision, default=str), ex=60)
        return

    features = _load_features(r, intersection_id)
    incidents = _check_incidents(r, intersection_id)

    # Set incident awareness on mode selector
    if isinstance(agent, ModeSelector) or (hasattr(agent, "_inner") and isinstance(getattr(agent, "_inner", None), ModeSelector)):
        selector = agent._inner if hasattr(agent, "_inner") else agent
        if isinstance(selector, ModeSelector) and incidents:
            for inc in incidents:
                selector.set_incident(intersection_id, inc.get("expires_at", time.time() + 120))

    t0 = time.time()
    decision = agent.decide(features)
    decision_time = time.time() - t0

    decision["decision_time_ms"] = round(decision_time * 1000, 1)
    decision["intersection_id"] = intersection_id

    # Publish for downstream consumers (outcome worker, dashboards)
    r.publish(f"decisions:{intersection_id}", json.dumps(decision, default=str))
    # Cache latest decision per intersection for /api/metrics (60s TTL)
    r.set(f"last_decision:{intersection_id}", json.dumps(decision, default=str), ex=60)

    # Persist to Mongo
    try:
        decisions_col.insert_one({
            "metrics": features,
            "decision": decision,
            "created_at": time.time(),
            "impl": AGENT_IMPL,
            "incidents_active": len(incidents),
            "outcome": None,
            "outcome_recorded_at": None,
        })
    except Exception as e:
        log.error("decision_persist_error", error=str(e))


if __name__ == "__main__":
    run()
