"""
agents/maxpressure.py — Stability-preserving Max-Pressure controller.

Based on Varaiya (2013) but hardened for a real signalized corridor:

  * **Smoothed observations.** Raw halted counts go to zero the instant a
    phase turns green, which would make naive argmax instantly prefer any
    other approach. We maintain an exponential moving average per approach
    so decisions are based on *recent* pressure, not the instantaneous
    (and biased) reading.
  * **Committed minimum green.** Once we pick a phase, we hold it for at
    least ``MIN_COMMIT_S``. This eliminates the oscillation mode where MP
    picks A, A drains a vehicle, now B > A, we switch, pay 5s clearance,
    pick B, etc.
  * **Drain-first.** As long as the currently-served approach still has
    queue and we're under ``MAX_COMMIT_S``, keep serving. The throughput
    cost of a switch (yellow + all-red) is roughly 5s × saturation =
    2.5 vehicles — so we only switch when the winning approach is
    *clearly* more pressured.
  * **Hysteresis gate.** Switch only if the challenger beats the
    incumbent by both a ratio (``HYST_RATIO``) and an absolute vehicle
    margin (``HYST_VEH``). Prevents ties from becoming churn.
  * **Starvation rotation.** Past ``MAX_COMMIT_S`` we rotate regardless —
    safety/fairness backstop.

The contract with ``SafetyWrapper`` is unchanged: we return PRIORITIZE
with a ``target_roi``; SafetyWrapper enforces physical MIN_GREEN /
MAX_GREEN / clearance at the TraCI layer.
"""
from __future__ import annotations
import os
from typing import Any, Dict

from .base import MasterAgentBase


DEFAULT_SAT_FLOW = float(1800 / 3600)  # veh/s/lane

MIN_COMMIT_S  = float(os.getenv("MP_MIN_COMMIT_S",  "6"))
MAX_COMMIT_S  = float(os.getenv("MP_MAX_COMMIT_S",  "45"))
DRAIN_THRESH  = float(os.getenv("MP_DRAIN_THRESH",  "1.0"))   # "approach drained" if EMA ≤ this
HYST_RATIO    = float(os.getenv("MP_HYST_RATIO",    "1.30"))  # challenger must beat incumbent by ×1.3
HYST_VEH      = float(os.getenv("MP_HYST_VEH",      "2.0"))   # ...and by ≥ 2 veh absolute
EMA_ALPHA     = float(os.getenv("MP_EMA_ALPHA",     "0.35"))  # new-value weight
STARVATION_S  = float(os.getenv("MP_STARVATION_S",  "75"))    # any approach unserved this long → force it

# Weight applied to anticipated platoon arrivals (veh-equivalents). Boosts
# the receiving approach's pressure so MaxPressure is aware of inbound
# vehicles from upstream greens (corridor coordination).
PLATOON_WEIGHT = float(os.getenv("MP_PLATOON_WEIGHT", "1.5"))
# Weight on pedestrian calls. 1 ped ≈ this many vehicle-equivalents.
PED_WEIGHT     = float(os.getenv("MP_PED_WEIGHT",     "0.8"))


class MaxPressureAgent(MasterAgentBase):
    """Phase-committed Max-Pressure with EMA-smoothed queue pressure."""

    def __init__(self, sat_flow: float = DEFAULT_SAT_FLOW):
        self._sat_flow = sat_flow
        # per-intersection state
        self._state: Dict[str, Dict[str, Any]] = {}

    def _get_state(self, intersection_id: str, approaches, now: float) -> Dict[str, Any]:
        st = self._state.get(intersection_id)
        if st is None:
            st = {
                "current_approach": None,   # approach we are currently committing to
                "phase_start_sim":  now,    # sim-time this commitment started
                "queue_ema":        {},     # approach -> smoothed queue
                "last_served":      {},     # approach -> sim-time last served (for starvation)
            }
            self._state[intersection_id] = st
        for a in approaches:
            st["queue_ema"].setdefault(a, 0.0)
            st["last_served"].setdefault(a, now)
        return st

    def decide(self, metrics: Dict[str, Any]) -> Dict[str, Any]:
        intersection_id = metrics.get("camera_name", metrics.get("intersection_id", "unknown"))

        vehicle_counts: Dict[str, Any]   = metrics.get("vehicle_counts") or {}
        traffic_metrics: Dict[str, Dict] = metrics.get("traffic_metrics") or {}
        # Downstream lane-halting counts for each approach, so we can build
        # true pressure = q_upstream - q_downstream (Varaiya 2013). Without
        # this, "max-pressure" degenerates to "max-queue" and ignores
        # spill-back on the receiving link.
        downstream_counts: Dict[str, float] = metrics.get("downstream_counts") or {}
        # Platoon boost injected by the hybrid orchestrator — veh-equivalent
        # added to the upstream side for the receiving approach.
        platoon_boost: Dict[str, float] = metrics.get("platoon_boost") or {}
        # Pedestrian calls: truthy approach -> 1, or explicit count.
        ped_calls = metrics.get("ped_calls") or {}
        if isinstance(ped_calls, (list, tuple, set)):
            ped_calls = {a: 1 for a in ped_calls}

        # Build raw per-approach pressure input. Prefer occupancy when
        # available (smoother than halted count) else fall back to queue.
        # synthesize_metrics_for_camera now returns per-lane-average occupancy
        # (always in [0,1]), so the occ<=1 branch always fires and the scale
        # occ*20 correctly represents "veh-equiv at full lane occupancy ≈ 20".
        raw: Dict[str, float] = {}
        for a, count in vehicle_counts.items():
            raw[a] = float(count)
        for a, tm in traffic_metrics.items():
            if isinstance(tm, dict) and "occupancy" in tm:
                occ = float(tm["occupancy"])
                # Scale occupancy (0..1 per-lane avg) into a veh-equivalent.
                raw[a] = max(raw.get(a, 0.0), occ * 20.0 if occ <= 1.0 else occ / 5.0)

        # Subtract downstream queue to form true Varaiya pressure. Clamp at
        # zero so a blocked receiving link doesn't flip the sign and make us
        # actively prefer an empty approach.
        for a in list(raw.keys()):
            down = float(downstream_counts.get(a, 0.0))
            raw[a] = max(0.0, raw[a] - down)

        # Add anticipated platoon arrivals, weighted. This encodes the
        # green-wave coordination signal into the pressure term so the
        # controller doesn't flip away from a receiving approach just
        # before a platoon lands.
        for a, boost in platoon_boost.items():
            if boost and a in raw:
                raw[a] += PLATOON_WEIGHT * float(boost)

        # Add pedestrian pressure (ped_count * PED_WEIGHT).
        for a, pc in ped_calls.items():
            try:
                pc_v = float(pc) if not isinstance(pc, bool) else (1.0 if pc else 0.0)
            except (TypeError, ValueError):
                pc_v = 1.0 if pc else 0.0
            if pc_v > 0 and a in raw:
                raw[a] += PED_WEIGHT * pc_v

        if not raw:
            return {
                "action":     "NO_ACTION",
                "target_roi": None,
                "reason":     "Max-Pressure: no queue data available",
                "mode":       "maxpressure",
            }

        now = float(metrics.get("_sim_time", 0.0) or 0.0)
        approaches = list(raw.keys())
        st = self._get_state(intersection_id, approaches, now)

        # --- Update EMA ---
        for a, q in raw.items():
            prev = st["queue_ema"].get(a, q)
            st["queue_ema"][a] = (1.0 - EMA_ALPHA) * prev + EMA_ALPHA * q

        # --- Compute pressures (veh-equivalent units; sat_flow scales uniformly) ---
        pressures = {a: st["queue_ema"][a] for a in approaches}
        best_approach = max(pressures, key=pressures.get)  # type: ignore[arg-type]
        best_pressure = pressures[best_approach]

        cur         = st["current_approach"]
        cur_pressure = pressures.get(cur, 0.0) if cur else 0.0
        phase_elapsed = now - st["phase_start_sim"]

        # --- Starvation backstop: any approach unserved for STARVATION_S wins ---
        most_starved: str = ""
        most_wait = 0.0
        for a in approaches:
            wait = now - st["last_served"].get(a, now)
            if wait > most_wait:
                most_wait = wait
                most_starved = a
        starvation_triggered = (most_starved
                                and most_wait > STARVATION_S
                                and most_starved != cur)

        # --- Decision tree ---
        decision_reason: str
        chosen: str

        if cur is None:
            # First decision at this intersection — pick the most pressured approach
            chosen = best_approach
            decision_reason = f"cold start -> {chosen} (p={best_pressure:.1f})"
            self._commit(st, chosen, now)

        elif starvation_triggered:
            chosen = most_starved
            decision_reason = (f"STARVATION rotate to {chosen} "
                               f"(waited {most_wait:.0f}s > {STARVATION_S:.0f}s)")
            self._commit(st, chosen, now)

        elif phase_elapsed < MIN_COMMIT_S:
            # Honour the minimum commitment window — do not reconsider.
            chosen = cur
            decision_reason = (f"hold {cur} (min commit {phase_elapsed:.0f}/"
                               f"{MIN_COMMIT_S:.0f}s, p={cur_pressure:.1f})")

        elif cur_pressure > DRAIN_THRESH and phase_elapsed < MAX_COMMIT_S:
            # Current approach still has demand — keep draining unless
            # the challenger clearly dominates.
            if (best_approach != cur
                    and best_pressure > cur_pressure * HYST_RATIO
                    and best_pressure > cur_pressure + HYST_VEH):
                chosen = best_approach
                decision_reason = (f"hysteresis flip {cur}->{chosen} "
                                   f"(p_cur={cur_pressure:.1f} < p_new={best_pressure:.1f})")
                self._commit(st, chosen, now)
            else:
                chosen = cur
                decision_reason = (f"drain {cur} (p={cur_pressure:.1f}, "
                                   f"elapsed={phase_elapsed:.0f}s)")

        else:
            # Current drained or hit max commit — pick the next-best non-current
            # if it has any meaningful pressure, else keep current.
            alternatives = {a: p for a, p in pressures.items() if a != cur}
            if alternatives:
                alt_best = max(alternatives, key=alternatives.get)  # type: ignore[arg-type]
                if pressures[alt_best] > DRAIN_THRESH or phase_elapsed >= MAX_COMMIT_S:
                    chosen = alt_best
                    decision_reason = (f"rotate {cur}->{chosen} "
                                       f"(cur drained or max_commit, p_new={pressures[alt_best]:.1f})")
                    self._commit(st, chosen, now)
                else:
                    chosen = cur
                    decision_reason = f"hold {cur} (all alternatives idle)"
            else:
                chosen = cur
                decision_reason = f"hold {cur} (no alternatives)"

        # Refresh the served timestamp for the chosen approach every cycle
        # (it's actively getting green time).
        st["last_served"][chosen] = now

        return {
            "action":     "PRIORITIZE",
            "target_roi": chosen,
            "reason":     f"Max-Pressure: {decision_reason}",
            "mode":       "maxpressure",
            "pressures":  {k: round(v, 3) for k, v in pressures.items()},
            "phase_elapsed": round(phase_elapsed, 1),
            "current_approach": cur,
            "downstream_q": {k: round(float(v), 3)
                             for k, v in downstream_counts.items()} if downstream_counts else {},
            "platoon_boost": {k: round(float(v), 3)
                              for k, v in platoon_boost.items()} if platoon_boost else {},
        }

    def _commit(self, st: Dict[str, Any], approach: str, now: float) -> None:
        st["current_approach"] = approach
        st["phase_start_sim"]  = now
