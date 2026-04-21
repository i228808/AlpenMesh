"""
services/outcome_worker.py — Feedback loop: measure outcomes 45s post-decision.

Subscribes to decisions:* pub/sub. For each decision, waits 45s, then
measures Δqueue and Δwait from Redis features, updates the decision's
outcome in Mongo, and appends (s,a,r,s') to the experience buffer.
"""
import asyncio
import json
import os
import signal
import sys
import time
from typing import Any, Dict

try:
    import redis
    HAS_REDIS = True
except ImportError:
    HAS_REDIS = False

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from db import decisions_col, experience_col
from observability.logging import configure_logging, log

REDIS_URL      = os.getenv("REDIS_URL", "redis://localhost:6379/0")
OUTCOME_DELAY  = float(os.getenv("OUTCOME_DELAY_S", "45"))
EXP_BUFFER_MAX = int(os.getenv("EXP_BUFFER_MAX", "100000"))

_running = True


def _sigterm_handler(signum, frame):
    global _running
    _running = False


async def _measure_outcome(r: "redis.Redis", decision: Dict[str, Any]) -> Dict[str, Any]:
    """Wait OUTCOME_DELAY then measure post-decision queue state."""
    await asyncio.sleep(OUTCOME_DELAY)

    intersection_id = decision.get("intersection_id", "unknown")
    target_roi = decision.get("target_roi", "")

    # Read current queue state from Redis
    post_queues: Dict[str, float] = {}
    for approach in ("N", "S", "E", "W"):
        key = f"feat:{intersection_id}:{approach}:through"
        data = r.hgetall(key)
        if data:
            try:
                post_queues[approach] = float(data.get("occupancy", 0))
            except (ValueError, TypeError):
                pass

    # Compare with pre-decision state
    pre_queues = {}
    metrics = decision.get("_pre_metrics", {})
    for roi, val in metrics.get("vehicle_counts", {}).items():
        pre_queues[roi] = float(val) if val else 0

    # Compute deltas
    total_pre = sum(pre_queues.values())
    total_post = sum(post_queues.values())
    delta_queue = total_post - total_pre

    outcome = {
        "delta_queue": round(delta_queue, 2),
        "pre_total": round(total_pre, 2),
        "post_total": round(total_post, 2),
        "post_queues": {k: round(v, 2) for k, v in post_queues.items()},
        "measured_at": time.time(),
        "delay_s": OUTCOME_DELAY,
    }

    # Reward: negative queue delta = good (queue reduced)
    reward = -delta_queue

    experience = {
        "intersection_id": intersection_id,
        "state": metrics.get("traffic_metrics", {}),
        "action": decision.get("action"),
        "target_roi": target_roi,
        "reward": round(reward, 3),
        "next_state": post_queues,
        "timestamp": time.time(),
    }

    return {"outcome": outcome, "experience": experience}


def run():
    configure_logging()
    signal.signal(signal.SIGTERM, _sigterm_handler)

    if not HAS_REDIS:
        log.error("redis package not installed; outcome_worker cannot start")
        sys.exit(1)

    r = redis.Redis.from_url(REDIS_URL, decode_responses=True)
    pubsub = r.pubsub()
    pubsub.psubscribe("decisions:*")

    log.info("outcome_worker starting", delay=OUTCOME_DELAY)

    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)

    async def _main():
        tasks = set()
        for message in pubsub.listen():
            if not _running:
                break
            if message["type"] not in ("pmessage",):
                continue

            try:
                decision = json.loads(message.get("data", "{}"))
            except (json.JSONDecodeError, TypeError):
                continue

            task = asyncio.create_task(_process_decision(r, decision))
            tasks.add(task)
            task.add_done_callback(tasks.discard)

        # Wait for pending tasks
        if tasks:
            await asyncio.gather(*tasks, return_exceptions=True)

    async def _process_decision(r_client, decision):
        try:
            result = await _measure_outcome(r_client, decision)
            outcome = result["outcome"]
            experience = result["experience"]

            # Update Mongo decision document
            decision_id = decision.get("_id")
            if decision_id:
                try:
                    decisions_col.update_one(
                        {"_id": decision_id},
                        {"$set": {"outcome": outcome, "outcome_recorded_at": time.time()}}
                    )
                except Exception:
                    pass

            # Append to experience buffer in Redis + Mongo
            exp_json = json.dumps(experience, default=str)
            r_client.lpush("exp:buffer", exp_json)
            r_client.ltrim("exp:buffer", 0, EXP_BUFFER_MAX - 1)

            try:
                experience_col.insert_one(experience)
            except Exception:
                pass

        except Exception as e:
            log.error("outcome_error", error=str(e))

    loop.run_until_complete(_main())
    pubsub.close()
    log.info("outcome_worker stopped")


if __name__ == "__main__":
    run()
