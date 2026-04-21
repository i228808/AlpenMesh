"""
agents/safety.py — Hard safety wrapper that enforces physical constraints.

All downstream deciders (MPC, Max-Pressure, rule-based) are advisory;
this wrapper is the final arbiter. It ensures no decision violates:
  - MIN_GREEN (7s): never switch before minimum green elapsed
  - MAX_GREEN (60s): force switch after maximum green elapsed
  - MAX_WAIT_PER_AXIS (90s): starvation guard
  - Yellow clearance (3s) + all-red (2s)
  - Pedestrian minimum (15s) when approach has ped call
"""
from __future__ import annotations
import os
import time
from typing import Any, Dict, Optional

from .base import MasterAgentBase

try:
    from observability.debug_log import dbg as _dbg_impl
except Exception:  # pragma: no cover
    def _dbg_impl(location, message, data=None):
        return

def _dbg(location, message, data=None):
    _dbg_impl(location, message, data)

MIN_GREEN_S         = float(os.getenv("MIN_GREEN_S",  "6"))
MAX_GREEN_S         = float(os.getenv("MAX_GREEN_S",  "60"))
MAX_WAIT_PER_AXIS_S = float(os.getenv("MAX_WAIT_PER_AXIS_S", "90"))
YELLOW_S            = float(os.getenv("YELLOW_S",  "3"))
ALL_RED_S           = float(os.getenv("ALL_RED_S", "2"))
PED_MIN_S           = float(os.getenv("PED_MIN_S", "15"))


class SafetyWrapper(MasterAgentBase):
    """Wraps any MasterAgentBase and enforces hard safety constraints.

    Time domain: uses sim_time (from metrics["_sim_time"]) when available,
    falling back to wall clock only when metrics don't carry one (e.g. dashboard preview).

    Approach tracking: keys are dynamically seeded from the actual approaches
    the cameras report (UP/DOWN/LEFT/RIGHT or anything else), not a hardcoded
    compass rose. `last_green` is updated whenever an approach is actively
    being served by the inner agent.

    Clearance (yellow + all-red) is orchestrated by `sumo_runner.apply_decision`
    at the TraCI layer. This wrapper only enforces *time-based* constraints:
    MIN_GREEN, MAX_GREEN, and per-approach starvation.
    """

    def __init__(self, inner: MasterAgentBase):
        self._inner = inner
        self._inter_state: Dict[str, Dict[str, Any]] = {}

    def _get_state(self, intersection_id: str, approaches, now: float) -> Dict[str, Any]:
        st = self._inter_state.get(intersection_id)
        if st is None:
            st = {
                "current_approach": None,       # last approach we actively served
                "phase_start":      now,        # sim-time when current approach started
                "last_green":       {},         # approach -> sim-time of last service
                # Ped-service tracking: sim-time when the current green began
                # serving a live pedestrian call, or None if none active.
                # This is what enforces PED_MIN_S before we allow any switch.
                "ped_service_start": None,
            }
            self._inter_state[intersection_id] = st
        # Seed newly-observed approaches as "just served" so they don't
        # spuriously register as starving on their first appearance.
        for a in approaches:
            st["last_green"].setdefault(a, now)
        return st

    def _clock(self, metrics: Dict[str, Any]) -> float:
        sim_t = metrics.get("_sim_time")
        return float(sim_t) if sim_t is not None else time.time()

    def decide(self, metrics: Dict[str, Any]) -> Dict[str, Any]:
        intersection_id = metrics.get("camera_name", metrics.get("intersection_id", "unknown"))
        now = self._clock(metrics)
        vehicle_counts: Dict[str, Any] = metrics.get("vehicle_counts") or {}
        approaches = list(vehicle_counts.keys())
        state = self._get_state(intersection_id, approaches, now)
        phase_elapsed = now - state["phase_start"]

        # Pedestrian call: either a set of approaches or a bool. We accept
        # any truthy indicator for the approach currently being served.
        # When an approach with a ped call starts its green, we latch
        # ``ped_service_start``. While latched, MIN_GREEN is raised to
        # max(MIN_GREEN_S, PED_MIN_S). MUTCD 4E.06 requires the pedestrian
        # walk + flashing-don't-walk interval to elapse before yielding.
        ped_calls = metrics.get("ped_calls") or {}
        if isinstance(ped_calls, (list, tuple, set)):
            ped_calls = {a: True for a in ped_calls}
        cur_app = state.get("current_approach")
        ped_active = bool(cur_app and ped_calls.get(cur_app))
        if ped_active and state.get("ped_service_start") is None:
            state["ped_service_start"] = now
        elif not ped_active:
            state["ped_service_start"] = None

        min_green_now = MIN_GREEN_S
        if state.get("ped_service_start") is not None:
            ped_elapsed = now - state["ped_service_start"]
            if ped_elapsed < PED_MIN_S:
                min_green_now = max(min_green_now, PED_MIN_S)

        # #region agent log
        _vc_keys = list(vehicle_counts.keys())
        _last_green_keys = list(state["last_green"].keys())
        _current_app = state.get("current_approach")
        # #endregion

        # MIN_GREEN: never switch before minimum green
        if phase_elapsed < min_green_now:
            # #region agent log
            _dbg("agents/safety.py:decide", "guard_MIN_GREEN", {
                "hypothesisId": "H1",
                "intersection": intersection_id,
                "sim_time": now, "sim_phase_elapsed": round(phase_elapsed, 3),
                "current_approach": _current_app,
                "MIN_GREEN_S": min_green_now,
                "ped_active":  ped_active,
            })
            # #endregion
            reason = (f"MIN_GREEN guard: phase only {phase_elapsed:.1f}s old "
                      f"(min {min_green_now}s)")
            if ped_active:
                reason += " [ped service]"
            return {
                "action": "EXTEND_CURRENT_PHASE",
                "target_roi": None,
                "reason": reason,
                "safety": True,
            }

        # Starvation: any approach that hasn't been green for too long wins immediately
        starved_roi: Optional[str] = None
        starved_wait = 0.0
        for a in approaches:
            w = now - state["last_green"].get(a, now)
            if w > MAX_WAIT_PER_AXIS_S and w > starved_wait:
                starved_roi = a
                starved_wait = w
        if starved_roi is not None:
            prev = state["current_approach"]
            if prev is not None:
                state["last_green"][prev] = now
            state["current_approach"] = starved_roi
            state["phase_start"] = now
            state["last_green"][starved_roi] = now
            # #region agent log
            _dbg("agents/safety.py:decide", "guard_STARVATION", {
                "hypothesisId": "H1,H4",
                "intersection": intersection_id,
                "sim_time": now, "sim_waited": round(starved_wait, 3),
                "starved_approach": starved_roi,
                "last_green_keys": _last_green_keys,
                "metric_vc_keys": _vc_keys,
                "current_approach": _current_app,
            })
            # #endregion
            return {
                "action": "SWITCH_GREEN",
                "target_roi": starved_roi,
                "reason": f"STARVATION guard: {starved_roi} waited {starved_wait:.0f}s (limit {MAX_WAIT_PER_AXIS_S}s)",
                "safety": True,
            }

        # MAX_GREEN: force a switch; prefer the approach with the largest queue
        # (excluding the one currently being served)
        if phase_elapsed > MAX_GREEN_S:
            prev = state["current_approach"]
            candidates = {a: vehicle_counts.get(a, 0) for a in approaches if a != prev}
            forced = (max(candidates, key=lambda k: candidates[k])
                      if candidates else (approaches[0] if approaches else None))
            if prev is not None:
                state["last_green"][prev] = now
            state["current_approach"] = forced
            state["phase_start"] = now
            if forced is not None:
                state["last_green"][forced] = now
            # #region agent log
            _dbg("agents/safety.py:decide", "guard_MAX_GREEN", {
                "hypothesisId": "H1",
                "intersection": intersection_id,
                "sim_time": now, "sim_phase_elapsed": round(phase_elapsed, 3),
                "MAX_GREEN_S": MAX_GREEN_S,
                "forced_target_roi": forced,
                "previous_approach": prev,
            })
            # #endregion
            return {
                "action": "SWITCH_GREEN",
                "target_roi": forced,
                "reason": f"MAX_GREEN guard: phase {phase_elapsed:.1f}s exceeds {MAX_GREEN_S}s limit",
                "safety": True,
            }

        # No constraint fired — delegate to inner agent.
        # Enrich the metrics with the safety wrapper's view of the current
        # physical phase so the inner agent (MPC, MaxPressure) can include
        # clearance cost / commitment logic in its decision.
        enriched = dict(metrics)
        enriched["_current_approach"] = state.get("current_approach")
        enriched["_phase_elapsed"]    = phase_elapsed
        decision = self._inner.decide(enriched)
        target = decision.get("target_roi")
        action = decision.get("action")

        # Track approach service so future starvation/MIN_GREEN decisions are accurate
        if action in ("PRIORITIZE", "SWITCH_GREEN", "EXTEND_GREEN", "KEEP_GREEN") and target:
            prev = state["current_approach"]
            if prev is None:
                # First decision at this intersection
                state["current_approach"] = target
                state["phase_start"] = now
            elif target != prev:
                # Genuine switch — apply_decision will orchestrate yellow/red clearance
                state["last_green"][prev] = now
                state["current_approach"] = target
                state["phase_start"] = now
            # Keep the currently-served approach fresh
            state["last_green"][target] = now

        # #region agent log
        _dbg("agents/safety.py:decide", "delegated_to_inner", {
            "hypothesisId": "H1,H4",
            "intersection": intersection_id,
            "sim_time": now, "sim_phase_elapsed": round(phase_elapsed, 3),
            "inner_action": action,
            "inner_target_roi": target,
            "inner_mode": decision.get("mode"),
            "metric_vc_keys": _vc_keys,
            "last_green_keys": list(state["last_green"].keys()),
            "current_approach": state["current_approach"],
        })
        # #endregion

        return decision

    def set_override(self, camera_name: str, action: str,
                     target_roi: Optional[str] = None, duration: int = 60) -> None:
        self._inner.set_override(camera_name, action, target_roi, duration)

    def clear_override(self, camera_name: str) -> None:
        self._inner.clear_override(camera_name)
