"""
agents/rule_based.py — Two-tier partially-observable corridor advisory agent.

Moved from the original master_agent.py. Implements MasterAgentBase so it
can be used interchangeably with MPC/Max-Pressure via MASTER_AGENT_IMPL.
"""
from __future__ import annotations
import os
import time
from typing import Any, Dict, Optional, Tuple

import yaml

from .base import MasterAgentBase
from predictors.ewma import HoltPredictor, PredictorRegistry
from corridor import CorridorManager

# Safety constraints (hard limits)
MIN_GREEN_S         = float(os.getenv("MIN_GREEN_S",  "7"))
MAX_GREEN_S         = float(os.getenv("MAX_GREEN_S",  "60"))
MAX_WAIT_PER_AXIS_S = float(os.getenv("MAX_WAIT_PER_AXIS_S", "90"))

# Demand-score weights.
#
# All feature terms are normalised into a comparable [0, ~2] range before
# weighting, so changing a single W isn't dominated by a scale mismatch.
# Previously the queue term (0..30+) completely drowned the others —
# see review §3.6. We keep the legacy env-var names so existing run
# configurations are preserved, but the defaults have been retuned for
# the new normalised features.
W1 = float(os.getenv("W_QUEUE",       "2.5"))  # normalised queue
W2 = float(os.getenv("W_CONGESTION",  "0.8"))  # categorical congestion (1..3)
W3 = float(os.getenv("W_WAIT",        "0.0"))  # now redundant with starvation; kept for back-compat
W4 = float(os.getenv("W_PREDICTION",  "1.2"))  # forecast + platoon boost
W5 = float(os.getenv("W_STARVATION",  "2.0"))  # starvation / wait (merged)
W6 = float(os.getenv("W_SWITCHING",   "0.3"))  # switch penalty
W7 = float(os.getenv("W_OCCUPANCY",   "1.0"))  # new: normalised lane occupancy
W8 = float(os.getenv("W_ARR_ON_RED",  "0.8"))  # new: predicted arrivals on red

# Queue normaliser: what counts as "fully loaded" for a standard approach.
QUEUE_NORM_VEH = float(os.getenv("QUEUE_NORM_VEH", "20.0"))

PLATOON_DROP_THRESHOLD = int(os.getenv("PLATOON_DROP_THRESHOLD", "4"))
HIGH_DEMAND_THRESHOLD  = float(os.getenv("HIGH_DEMAND_THRESHOLD", "4.0"))
LOW_DEMAND_THRESHOLD   = float(os.getenv("LOW_DEMAND_THRESHOLD",  "1.0"))
STUCK_COLOR_THRESHOLD  = 20


class RuleBasedMasterAgent(MasterAgentBase):
    """
    Two-tier partially-observable corridor advisory agent.

    Tier 1 — per-camera axis demand score (6-term weighted formula)
    Tier 2 — intersection-level arbitration for paired cameras
    """

    _CONGESTION_WEIGHT = {"low": 1, "medium": 2, "high": 3}

    def __init__(self):
        self._predictors = PredictorRegistry(alpha=0.3, beta=0.1)

        _cfg_dir = os.path.dirname(os.path.abspath(__file__))
        _master_dir = os.path.dirname(_cfg_dir)  # up from agents/ to MasterAgent/
        self._corridor_mgr = CorridorManager.from_yaml(
            corridor_yaml=os.path.join(_master_dir, "corridor_config.yaml"),
            camera_yaml=os.path.join(_master_dir, "camera_config.yaml"),
        )

        self._inter_state: Dict[str, Dict[str, Any]] = {}
        self._prev_queue: Dict[Tuple[str, str], int] = {}
        self._tier2_staging: Dict[str, Dict[str, Any]] = {}
        self._paired_cameras: Dict[str, str] = {}
        self._load_paired_config(_master_dir)
        self._color_history: Dict[str, Dict[str, Any]] = {}
        self.active_overrides: Dict[str, Dict[str, Any]] = {}

    def _load_paired_config(self, cfg_dir: str) -> None:
        cam_yaml = os.path.join(cfg_dir, "camera_config.yaml")
        try:
            with open(cam_yaml) as f:
                data = yaml.safe_load(f)
            for name, info in (data.get("cameras") or {}).items():
                partner = info.get("paired_with")
                if partner:
                    self._paired_cameras[name] = partner
        except FileNotFoundError:
            pass

    # ---- Override helpers ----

    def set_override(self, camera_name: str, action: str,
                     target_roi: Optional[str] = None, duration: int = 60) -> None:
        self.active_overrides[camera_name] = {
            "action": action,
            "target_roi": target_roi,
            "expires_at": time.time() + duration,
        }

    def clear_override(self, camera_name: str) -> None:
        self.active_overrides.pop(camera_name, None)

    # ---- Intersection state helpers ----

    def _get_inter_state(self, camera_name: str) -> Dict[str, Any]:
        if camera_name not in self._inter_state:
            now = time.time()
            self._inter_state[camera_name] = {
                "current_phase_axis": "UP",
                "phase_start_time": now,
                "last_green_time_UP": now - 30,
                "last_green_time_DOWN": now - 60,
            }
        return self._inter_state[camera_name]

    def _update_inter_state(self, camera_name: str,
                            new_axis: str, switched: bool) -> None:
        from db import inter_state_col
        state = self._get_inter_state(camera_name)
        now = time.time()
        if switched:
            state["last_green_time_" + state["current_phase_axis"]] = now
            state["current_phase_axis"] = new_axis
            state["phase_start_time"] = now
        try:
            inter_state_col.update_one(
                {"camera_name": camera_name},
                {"$set": {**state, "camera_name": camera_name, "updated_at": now}},
                upsert=True,
            )
        except Exception:
            pass

    # ---- Signal helpers (legacy) ----

    def _get_current_signal(self, traffic_lights: list
                            ) -> Tuple[Optional[str], Optional[str], float]:
        if not traffic_lights:
            return None, None, 0.0
        best = max(traffic_lights, key=lambda x: x.get("confidence", 0.0))
        return best.get("color"), best.get("nearest_roi"), float(best.get("confidence", 0.0))

    def _update_color_history(self, camera_name: str,
                              color: Optional[str]) -> Optional[str]:
        if color is None:
            return None
        entry = self._color_history.get(camera_name)
        if entry is None:
            self._color_history[camera_name] = {"last_color": color, "count": 1}
            return None
        if entry["last_color"] == color:
            entry["count"] += 1
        else:
            entry["last_color"] = color
            entry["count"] = 1
        if entry["count"] >= STUCK_COLOR_THRESHOLD and color in ("Red", "Yellow", "Green"):
            return "LIGHT_STUCK_" + color
        return None

    # ---- Tier-1: Axis demand score ----

    def _congestion_score(self, label: str) -> float:
        return float(self._CONGESTION_WEIGHT.get(label.lower(), 1))

    def _compute_axis_score(self, camera_name: str, direction: str,
                            vehicle_counts: Dict[str, int],
                            congestion_levels: Dict[str, str],
                            inter_state: Dict[str, Any],
                            current_phase_axis: str,
                            traffic_metrics: Optional[Dict[str, Any]] = None,
                            ped_calls: Optional[Dict[str, Any]] = None) -> float:
        """Axis demand score (normalised, §3.6 fix).

        All feature terms are mapped to comparable ranges before being
        weighted — previously raw queue (0..30+) swamped everything else,
        so picking a different weight for wait/starvation had no effect.

        Terms (all ≥ 0 unless noted):
            q_norm     queue / QUEUE_NORM_VEH               ∈ [0, 1+]
            occ_norm   occupancy-derived queue-equivalent   ∈ [0, 1+]
            cong_w     categorical {low:1, med:2, high:3}
            pred_norm  max(0, Holt h=2 forecast) / QUEUE_NORM_VEH
            platoon    CorridorManager.get_platoon_boost    ∈ [0, 3]
            starve     min(wait / MAX_WAIT_PER_AXIS_S, 2)   ∈ [0, 2]
            ped        normalised pedestrian calls          ∈ [0, 1]
            switch     1 if a phase switch is required, 0 else
        """
        d = direction.upper()
        traffic_metrics = traffic_metrics or {}
        ped_calls = ped_calls or {}

        queue = float(vehicle_counts.get(d, 0))
        q_norm = queue / QUEUE_NORM_VEH

        occ_raw = 0.0
        tm = traffic_metrics.get(d)
        if isinstance(tm, dict) and "occupancy" in tm:
            occ = float(tm.get("occupancy", 0.0))
            # Accept both 0..1 and 0..100 conventions.
            occ_raw = occ if occ <= 1.0 else occ / 100.0
        occ_norm = min(occ_raw, 2.0)

        cong_w = self._congestion_score(congestion_levels.get(d, "Low"))

        predictor = self._predictors.get(camera_name, d)
        predictor.update(queue)
        # Look 2 steps out — far enough to anticipate, near enough the
        # trend is still informative.
        predicted = max(0.0, predictor.forecast(h=2))
        pred_norm = predicted / QUEUE_NORM_VEH

        platoon_boost = float(self._corridor_mgr.get_platoon_boost(camera_name, d))

        # Wait / starvation — merged into a single monotonic term so that
        # the weight actually controls how aggressively we rotate.
        last_green_key = f"last_green_time_{d}"
        last_green_time = inter_state.get(last_green_key, time.time() - 30)
        time_since_green = max(0.0, time.time() - last_green_time)
        starve = min(time_since_green / MAX_WAIT_PER_AXIS_S, 2.0)

        # Pedestrian pressure (0..1).
        try:
            ped_val = ped_calls.get(d, 0)
            if isinstance(ped_val, bool):
                ped_n = 1.0 if ped_val else 0.0
            else:
                ped_n = min(float(ped_val) / 3.0, 1.0)
        except (TypeError, ValueError):
            ped_n = 0.0

        switching_penalty = 0.0 if d == current_phase_axis else 1.0

        # Arrivals-on-red bonus: if we're not currently serving this axis
        # and the forecast predicts inflow, raise its priority. Captures
        # the idea that a red approach with predicted arrivals should get
        # served before the queue grows.
        arr_on_red = 0.0
        if d != current_phase_axis and pred_norm > 0:
            arr_on_red = pred_norm

        score = (
            W1 * q_norm
            + W7 * occ_norm
            + W2 * cong_w
            + W3 * min(time_since_green / MAX_WAIT_PER_AXIS_S, 1.0)  # legacy wait term (W3 default=0)
            + W4 * (pred_norm + platoon_boost)
            + W8 * arr_on_red
            + W5 * starve
            + 0.5 * ped_n  # light ped weight — safety wrapper does the hard enforcement
            - W6 * switching_penalty
        )
        return max(0.0, score)

    # ---- Platoon detection ----

    def _check_and_fire_platoon(self, camera_name: str, direction: str,
                                current_queue: int, action: str) -> None:
        key = (camera_name, direction.upper())
        prev = self._prev_queue.get(key, 0)
        drop = prev - current_queue
        if drop >= PLATOON_DROP_THRESHOLD and action in ("SWITCH_GREEN", "EXTEND_GREEN"):
            self._corridor_mgr.on_platoon_released(
                camera_name=camera_name,
                direction=direction,
                queue_size=prev,
            )
        self._prev_queue[key] = current_queue

    # ---- Safety constraint check ----

    def _check_safety_constraints(self, inter_state: Dict[str, Any],
                                  score_up: float, score_down: float
                                  ) -> Optional[Dict[str, Any]]:
        now = time.time()
        phase_axis = inter_state["current_phase_axis"]
        phase_elapsed = now - inter_state.get("phase_start_time", now)

        if phase_elapsed < MIN_GREEN_S:
            return {
                "action": "EXTEND_CURRENT_PHASE",
                "target_roi": phase_axis,
                "reason": f"MIN_GREEN guard: phase only {phase_elapsed:.1f}s old",
                "_forced": True,
            }

        if phase_elapsed > MAX_GREEN_S:
            other_axis = "DOWN" if phase_axis == "UP" else "UP"
            return {
                "action": "SWITCH_GREEN",
                "target_roi": other_axis,
                "reason": f"MAX_GREEN guard: phase has been {phase_elapsed:.1f}s ({MAX_GREEN_S}s limit)",
                "_forced": True,
            }

        for axis in ("UP", "DOWN"):
            last_green = inter_state.get(f"last_green_time_{axis}", now - 30)
            waited = now - last_green
            if waited > MAX_WAIT_PER_AXIS_S:
                return {
                    "action": "SWITCH_GREEN",
                    "target_roi": axis,
                    "reason": f"STARVATION guard: {axis} axis waited {waited:.0f}s (limit {MAX_WAIT_PER_AXIS_S}s)",
                    "_forced": True,
                }

        return None

    # ---- Main: decide() ----

    def decide(self, metrics: Dict[str, Any]) -> Dict[str, Any]:
        camera_name = metrics.get("camera_name", "Unknown")

        override = self.active_overrides.get(camera_name)
        if override:
            if time.time() > override["expires_at"]:
                del self.active_overrides[camera_name]
            else:
                return {
                    "action": override["action"],
                    "target_roi": override["target_roi"],
                    "reason": "MANUAL OVERRIDE",
                    "anomaly": None,
                    "is_override": True,
                }

        vehicle_counts: Dict[str, int] = metrics.get("vehicle_counts", {}) or {}
        congestion_levels: Dict[str, str] = metrics.get("congestion_levels", {}) or {}
        traffic_metrics: Dict[str, Any] = metrics.get("traffic_metrics", {}) or {}
        traffic_lights: list = metrics.get("traffic_lights", []) or []
        total_vehicles: int = metrics.get("total_vehicles", sum(vehicle_counts.values()))
        ped_calls_raw = metrics.get("ped_calls") or {}
        if isinstance(ped_calls_raw, (list, tuple, set)):
            ped_calls_raw = {a: True for a in ped_calls_raw}

        color, current_roi, conf = self._get_current_signal(traffic_lights)
        anomaly = self._update_color_history(camera_name, color)

        # No-vehicle short-circuit: total_vehicles covers the case where
        # callers pass an empty / all-zero vehicle_counts dict, and also
        # avoids triggering the MIN_GREEN guard below when there's
        # literally nothing to decide.
        _counts_sum = sum(int(v or 0) for v in vehicle_counts.values())
        if total_vehicles == 0 and _counts_sum == 0:
            return {
                "action": "NO_ACTION", "target_roi": None,
                "reason": "No vehicles detected", "anomaly": anomaly,
                "score_up": 0.0, "score_down": 0.0, "tier": 1,
            }

        if color == "Yellow":
            return {
                "action": "EXTEND_CURRENT_PHASE", "target_roi": current_roi,
                "reason": "Light is Yellow — never switch on yellow", "anomaly": anomaly,
                "score_up": 0.0, "score_down": 0.0, "tier": 1,
            }

        inter_state = self._get_inter_state(camera_name)
        phase_axis = inter_state["current_phase_axis"]

        if color == "Green" and current_roi in ("UP", "DOWN") and conf >= 0.7:
            inter_state["current_phase_axis"] = current_roi
            phase_axis = current_roi

        score_up = self._compute_axis_score(camera_name, "UP",
                                            vehicle_counts, congestion_levels,
                                            inter_state, phase_axis,
                                            traffic_metrics=traffic_metrics,
                                            ped_calls=ped_calls_raw)
        score_down = self._compute_axis_score(camera_name, "DOWN",
                                              vehicle_counts, congestion_levels,
                                              inter_state, phase_axis,
                                              traffic_metrics=traffic_metrics,
                                              ped_calls=ped_calls_raw)

        forced = self._check_safety_constraints(inter_state, score_up, score_down)
        if forced:
            decision = {
                **forced, "anomaly": anomaly,
                "score_up": round(score_up, 3), "score_down": round(score_down, 3), "tier": 1,
            }
            self._finalise(camera_name, decision, vehicle_counts, inter_state)
            return decision

        partner = self._paired_cameras.get(camera_name)
        if partner and partner in self._tier2_staging:
            decision = self._tier2_resolve(camera_name, partner, score_up, score_down,
                                           vehicle_counts, inter_state, anomaly)
            if decision:
                self._finalise(camera_name, decision, vehicle_counts, inter_state)
                return decision

        if partner:
            self._tier2_staging[camera_name] = {
                "score_up": score_up, "score_down": score_down,
                "phase_axis": phase_axis, "ts": time.time(),
            }

        up_count = vehicle_counts.get("UP", 0)
        down_count = vehicle_counts.get("DOWN", 0)
        has_both = (up_count + down_count) > 0

        if not has_both:
            decision = {
                "action": "NO_ACTION", "target_roi": phase_axis,
                "reason": "No vehicle data on either axis", "anomaly": anomaly,
                "score_up": 0.0, "score_down": 0.0, "tier": 1,
            }
            self._finalise(camera_name, decision, vehicle_counts, inter_state)
            return decision

        active_score = score_up if up_count > 0 else score_down
        active_dir = "UP" if up_count > 0 else "DOWN"
        other_dir = "DOWN" if active_dir == "UP" else "UP"
        one_sided = (up_count == 0 or down_count == 0)

        if one_sided:
            if active_score >= HIGH_DEMAND_THRESHOLD:
                recommended_axis = active_dir
                action = "SWITCH_GREEN" if recommended_axis != phase_axis else "EXTEND_GREEN"
                reason = f"HALF-OBSERVED (high demand on {active_dir}): score={active_score:.2f} >= {HIGH_DEMAND_THRESHOLD}"
            elif active_score <= LOW_DEMAND_THRESHOLD:
                recommended_axis = other_dir
                action = "SWITCH_GREEN" if recommended_axis != phase_axis else "EXTEND_GREEN"
                reason = f"HALF-OBSERVED (low demand on {active_dir}): score={active_score:.2f} <= {LOW_DEMAND_THRESHOLD}"
            else:
                recommended_axis = phase_axis
                action = "EXTEND_CURRENT_PHASE"
                reason = f"HALF-OBSERVED (medium demand on {active_dir}): score={active_score:.2f}"
        else:
            recommended_axis = "UP" if score_up >= score_down else "DOWN"
            if recommended_axis == phase_axis:
                action = "EXTEND_GREEN"
                reason = f"Tier-1: {recommended_axis} score={score_up if recommended_axis == 'UP' else score_down:.2f} >= opposing"
            else:
                action = "SWITCH_GREEN"
                reason = f"Tier-1: {recommended_axis} score={score_up if recommended_axis == 'UP' else score_down:.2f} > {phase_axis}"

        decision = {
            "action": action, "target_roi": recommended_axis,
            "reason": reason, "anomaly": anomaly,
            "score_up": round(score_up, 3), "score_down": round(score_down, 3), "tier": 1,
        }
        self._finalise(camera_name, decision, vehicle_counts, inter_state)
        return decision

    # ---- Tier-2 ----

    def _tier2_resolve(self, camera_name: str, partner: str,
                       score_up: float, score_down: float,
                       vehicle_counts: Dict[str, int],
                       inter_state: Dict[str, Any],
                       anomaly: Optional[str]) -> Optional[Dict[str, Any]]:
        staged = self._tier2_staging.get(partner)
        if not staged:
            return None
        if time.time() - staged["ts"] > 5.0:
            self._tier2_staging.pop(partner, None)
            return None

        my_best = max(score_up, score_down)
        my_axis = "UP" if score_up >= score_down else "DOWN"
        their_best = max(staged["score_up"], staged["score_down"])
        their_axis = "UP" if staged["score_up"] >= staged["score_down"] else "DOWN"

        self._tier2_staging.pop(partner, None)
        self._tier2_staging.pop(camera_name, None)

        if my_best >= their_best:
            winner_cam, winner_axis = camera_name, my_axis
            winner_score, loser_score = my_best, their_best
        else:
            winner_cam, winner_axis = partner, their_axis
            winner_score, loser_score = their_best, my_best

        phase_axis = inter_state["current_phase_axis"]
        action = "SWITCH_GREEN" if winner_axis != phase_axis else "EXTEND_GREEN"

        return {
            "action": action, "target_roi": winner_axis,
            "reason": f"Tier-2: {winner_cam} ({winner_axis}) score={winner_score:.2f} > partner score={loser_score:.2f}",
            "anomaly": anomaly,
            "score_up": round(score_up, 3), "score_down": round(score_down, 3),
            "tier": 2, "winning_camera": winner_cam,
        }

    # ---- Post-decision ----

    def _finalise(self, camera_name: str, decision: Dict[str, Any],
                  vehicle_counts: Dict[str, int], inter_state: Dict[str, Any]) -> None:
        action = decision.get("action", "")
        target_roi = decision.get("target_roi", inter_state["current_phase_axis"])
        switched = (action == "SWITCH_GREEN")
        self._update_inter_state(camera_name, target_roi or inter_state["current_phase_axis"], switched)
        for direction in ("UP", "DOWN"):
            count = vehicle_counts.get(direction, 0)
            self._check_and_fire_platoon(camera_name, direction, count, action)
