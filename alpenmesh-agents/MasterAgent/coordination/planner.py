"""
coordination/planner.py — CorridorPlanner: periodically re-solves MAXBAND offsets.

Runs as a singleton (Redis lock) and publishes offset updates to Redis.
Re-solves every 3 minutes or when travel times change by ≥15%.
"""
from __future__ import annotations
import json
import os
import time
import signal
import sys
from typing import Any, Dict, List, Optional, Tuple

import yaml

try:
    import redis as redis_lib
    HAS_REDIS = True
except ImportError:
    HAS_REDIS = False

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from coordination.maxband import solve_maxband, webster_cycle
from observability.logging import configure_logging, log

REDIS_URL       = os.getenv("REDIS_URL", "redis://localhost:6379/0")
SOLVE_INTERVAL  = float(os.getenv("CORRIDOR_SOLVE_INTERVAL_S", "180"))  # 3 min
SPEED_CHANGE_PCT = float(os.getenv("CORRIDOR_SPEED_CHANGE_PCT", "15"))
DEFAULT_SPEED   = 13.4  # m/s ≈ 30 mph
LOCK_TTL        = 15
LOCK_KEY        = "lock:corridor_planner"

# Webster sizing.
# Saturation flow (veh/s) per lane group — ~1900 veh/h/lane ≈ 0.53 veh/s.
# For a typical two-phase NS/EW intersection we assume ~2 lane groups of
# similar capacity, so sat flow per group ~0.53 veh/s.
SAT_FLOW_PER_GROUP = float(os.getenv("SAT_FLOW_PER_GROUP", "0.53"))
# Lost time per cycle (startup + clearance) ≈ YELLOW+ALL_RED per phase × 2.
LOST_TIME_S        = float(os.getenv("LOST_TIME_S", "10"))
# Green ratio floor to keep both axes served; Webster allocates the rest.
MIN_GREEN_RATIO    = float(os.getenv("MIN_GREEN_RATIO", "0.25"))
MAX_GREEN_RATIO    = float(os.getenv("MAX_GREEN_RATIO", "0.75"))

_running = True


def _sigterm_handler(signum, frame):
    global _running
    _running = False


def _load_corridors(master_dir: str) -> Dict[str, Dict]:
    """Load corridor definitions from corridor_config.yaml."""
    path = os.path.join(master_dir, "corridor_config.yaml")
    try:
        with open(path) as f:
            data = yaml.safe_load(f) or {}
        return data.get("corridors", {})
    except FileNotFoundError:
        return {}


def _get_live_speed(r: "redis_lib.Redis", camera_a: str, camera_b: str) -> float:
    """Estimate live speed between two cameras from mean_dwell_sec."""
    for cam in (camera_a, camera_b):
        cam_norm = cam.replace(" & ", "__").replace(" ", "_")
        for approach in ("N", "S", "E", "W"):
            key = f"feat:{cam_norm}:{approach}:through"
            data = r.hgetall(key)
            if data and "mean_dwell_sec" in data:
                dwell = float(data.get("mean_dwell_sec", 0))
                if dwell > 2.0:
                    return max(3.0, DEFAULT_SPEED * (1.0 - min(dwell / 30.0, 0.7)))
    return DEFAULT_SPEED


def _get_live_demand(r: "redis_lib.Redis", camera: str) -> Dict[str, float]:
    """Return rough per-axis flow estimates (veh/s) for a camera.

    Pulls ``arrivals_per_min`` out of Redis feature hashes. Missing values
    default to a moderate baseline so Webster never produces a degenerate
    tiny cycle.
    """
    cam_norm = camera.replace(" & ", "__").replace(" ", "_")
    ns = 0.0
    ew = 0.0
    for appr in ("N", "S", "E", "W"):
        key = f"feat:{cam_norm}:{appr}:through"
        try:
            data = r.hgetall(key)
        except Exception:
            data = None
        if not data:
            continue
        apm = float(data.get("arrivals_per_min", 0.0) or 0.0)
        flow_vps = apm / 60.0
        if appr in ("N", "S"):
            ns += flow_vps
        else:
            ew += flow_vps
    if ns <= 0 and ew <= 0:
        return {"NS": 0.15, "EW": 0.15}
    return {"NS": max(ns, 0.05), "EW": max(ew, 0.05)}


def _compute_webster_plan(r: "redis_lib.Redis", cameras: List[str]) -> Tuple[float, List[float]]:
    """Compute a common Webster cycle and per-intersection green ratios."""
    max_cycle = 60.0
    ratios: List[float] = []
    for cam in cameras:
        demand = _get_live_demand(r, cam)
        ns_flow = demand["NS"]
        ew_flow = demand["EW"]
        cycle = webster_cycle(
            flows=[ns_flow, ew_flow],
            sat_flows=[SAT_FLOW_PER_GROUP, SAT_FLOW_PER_GROUP],
            lost_time=LOST_TIME_S,
        )
        max_cycle = max(max_cycle, cycle)
        total = ns_flow + ew_flow
        if total > 0:
            ratio_ns = ns_flow / total
        else:
            ratio_ns = 0.5
        ratio_ns = max(MIN_GREEN_RATIO, min(MAX_GREEN_RATIO, ratio_ns))
        ratios.append(ratio_ns)
    cycle_final = round(max_cycle / 5.0) * 5.0
    return cycle_final, ratios


def run():
    configure_logging()
    signal.signal(signal.SIGTERM, _sigterm_handler)

    if not HAS_REDIS:
        log.error("redis not installed; corridor_planner cannot start")
        sys.exit(1)

    r = redis_lib.Redis.from_url(REDIS_URL, decode_responses=True)
    master_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    corridors = _load_corridors(master_dir)

    if not corridors:
        log.warning("no corridors found in corridor_config.yaml")
        return

    log.info("corridor_planner starting", n_corridors=len(corridors))

    prev_travel_times: Dict[str, List[float]] = {}
    last_solve = 0.0

    while _running:
        # Try to acquire leader lock
        acquired = r.set(LOCK_KEY, "1", nx=True, ex=LOCK_TTL)
        if not acquired:
            time.sleep(5)
            continue

        now = time.time()
        should_solve = (now - last_solve) >= SOLVE_INTERVAL

        if not should_solve:
            # Check if travel times changed significantly
            for cid, cdef in corridors.items():
                cameras = cdef.get("cameras_ordered", [])
                dist = cdef.get("avg_block_distance_m", 100)
                tt = _compute_travel_times(r, cameras, dist)
                prev = prev_travel_times.get(cid, [])
                if prev and _pct_change(prev, tt) >= SPEED_CHANGE_PCT:
                    should_solve = True
                    break

        if should_solve:
            for cid, cdef in corridors.items():
                cameras = cdef.get("cameras_ordered", [])
                dist = cdef.get("avg_block_distance_m", 100)
                tt = _compute_travel_times(r, cameras, dist)
                prev_travel_times[cid] = tt

                # Webster-sized common cycle + dynamic green ratios from live demand.
                cycle, green_ratios = _compute_webster_plan(r, cameras)

                cam_ids = [c.replace(" & ", "__").replace(" ", "_") for c in cameras]
                offsets = solve_maxband(cam_ids, tt, green_ratios, cycle)

                plan = {
                    "cycle": cycle,
                    "green_ratios": {cam_ids[i]: round(r_, 3)
                                     for i, r_ in enumerate(green_ratios)},
                    "offsets": offsets or {},
                    "travel_times": [round(t, 2) for t in tt],
                    "ts": now,
                }

                plan_json = json.dumps(plan)
                pipe = r.pipeline()
                pipe.set(f"corridor:{cid}:plan", plan_json)
                if offsets:
                    offset_json = json.dumps(offsets)
                    pipe.set(f"corridor:{cid}:offsets", offset_json)
                    pipe.publish(f"corridor:{cid}:offsets_updated", offset_json)
                pipe.publish(f"corridor:{cid}:plan_updated", plan_json)
                pipe.execute()

                if offsets:
                    log.info("corridor_plan_updated", corridor=cid,
                             cycle=cycle, green_ratios=plan["green_ratios"],
                             offsets=offsets)
                else:
                    log.warning("corridor_solve_failed", corridor=cid,
                                cycle=cycle, green_ratios=plan["green_ratios"])

            last_solve = now

        # Heartbeat the lock
        r.expire(LOCK_KEY, LOCK_TTL)
        time.sleep(10)

    log.info("corridor_planner stopped")


def _compute_travel_times(r: "redis_lib.Redis", cameras: List[str], avg_dist: float) -> List[float]:
    """Compute travel times between consecutive cameras using live speeds."""
    times = []
    for i in range(len(cameras) - 1):
        speed = _get_live_speed(r, cameras[i], cameras[i + 1])
        times.append(avg_dist / speed if speed > 0 else avg_dist / DEFAULT_SPEED)
    return times


def _pct_change(old: List[float], new: List[float]) -> float:
    """Max percentage change between two travel time vectors."""
    if len(old) != len(new) or not old:
        return 100.0
    changes = []
    for a, b in zip(old, new):
        if a > 0:
            changes.append(abs(b - a) / a * 100)
    return max(changes) if changes else 0.0


if __name__ == "__main__":
    run()
