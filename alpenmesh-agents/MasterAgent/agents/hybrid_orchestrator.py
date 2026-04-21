"""
agents/hybrid_orchestrator.py — Forecast + corridor coordination layer for hybrid mode.

Sits between :class:`SafetyWrapper` and :class:`ModeSelector` (MPC/MP).
On every decision cycle it:

* Feeds a per-(camera, approach) :class:`HoltPredictor` with the latest
  observed queue and stuffs a multi-step arrival forecast into
  ``metrics["arrival_forecasts"]`` before forwarding to the inner agent —
  this is what lets MPC anticipate inflow instead of assuming a constant
  background rate.
* Detects large queue drops (``MIN_PLATOON_QUEUE`` vehicles) and fires
  :meth:`CorridorManager.on_platoon_released` so downstream intersections
  get green-wave boost.
* Reads :meth:`CorridorManager.get_platoon_boost` for the receiving
  camera and injects both a scalar ``platoon_boost`` (consumed by
  MaxPressure as an additive pressure term) and a step-indexed
  ``_platoon_injection`` spike (consumed by MPC as an arrival forecast
  additive).

Graceful degradation: if the corridor YAML is missing, the orchestrator
still provides forecasts. If the predictor hasn't seen enough data yet,
it returns the live queue as the forecast.
"""
from __future__ import annotations
import math
import os
import time
from typing import Any, Dict, List, Optional, Tuple

from .base import MasterAgentBase

try:
    from predictors.ewma import HoltPredictor, PredictorRegistry
except Exception:  # pragma: no cover - predictor package should always import
    HoltPredictor = None  # type: ignore
    PredictorRegistry = None  # type: ignore

try:
    from predictors.ensemble import EnsembleForecaster, EnsembleRegistry
except Exception:  # pragma: no cover
    EnsembleForecaster = None  # type: ignore
    EnsembleRegistry = None  # type: ignore

try:
    from corridor import CorridorManager
except Exception:  # pragma: no cover
    CorridorManager = None  # type: ignore

try:
    from observability.debug_log import dbg as _dbg_impl
except Exception:  # pragma: no cover
    def _dbg_impl(location, message, data=None):
        return


MPC_HORIZON      = int(os.getenv("MPC_HORIZON_STEPS", "6"))
MPC_STEP_S       = float(os.getenv("MPC_STEP_S", "5"))
# Drop threshold for detecting platoon release — matches the rule_based
# agent and CorridorManager.MIN_PLATOON_QUEUE (default 4).
PLATOON_DROP     = int(os.getenv("PLATOON_DROP_THRESHOLD", "4"))
# Minimum number of predictor updates before we trust a forecast enough
# to use the trend line. Below this we return a smoothed queue value.
FORECAST_WARMUP  = int(os.getenv("HYBRID_FORECAST_WARMUP", "3"))
# Travel speed used to project platoons into MPC future steps (m/s).
PLATOON_SPEED_MS = float(os.getenv("HYBRID_PLATOON_SPEED_MS", "13.4"))  # ≈ 30 mph


class HybridOrchestrator(MasterAgentBase):
    """Forecast + corridor wrapper around an inner decision engine."""

    def __init__(self,
                 inner: MasterAgentBase,
                 predictors=None,
                 corridor_mgr=None,
                 corridor_yaml: Optional[str] = None,
                 camera_yaml: Optional[str] = None,
                 use_ensemble: bool = True):
        self._inner = inner
        if predictors is None:
            if use_ensemble and EnsembleRegistry is not None:
                predictors = EnsembleRegistry(alpha=0.3, beta=0.1)
            elif PredictorRegistry is not None:
                predictors = PredictorRegistry(alpha=0.3, beta=0.1)
        self._predictors = predictors
        # Track whether the registry is ensemble-capable for record_actual.
        self._is_ensemble = bool(
            EnsembleRegistry is not None
            and isinstance(predictors, EnsembleRegistry)
        )

        if corridor_mgr is None and CorridorManager is not None:
            try:
                base = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
                corridor_mgr = CorridorManager.from_yaml(
                    corridor_yaml=corridor_yaml or os.path.join(base, "corridor_config.yaml"),
                    camera_yaml=camera_yaml or os.path.join(base, "camera_config.yaml"),
                )
            except Exception:
                corridor_mgr = CorridorManager()
        self._corridor_mgr = corridor_mgr

        # Per-(camera, approach) previous-queue tracker for drop detection.
        self._prev_queue: Dict[Tuple[str, str], float] = {}

    # ------------------------------------------------------------------
    # Public delegation
    # ------------------------------------------------------------------

    def set_override(self, camera_name: str, action: str,
                     target_roi: Optional[str] = None, duration: int = 60) -> None:
        self._inner.set_override(camera_name, action, target_roi, duration)

    def clear_override(self, camera_name: str) -> None:
        self._inner.clear_override(camera_name)

    # For tests / dashboards
    @property
    def corridor_mgr(self):
        return self._corridor_mgr

    @property
    def predictors(self):
        return self._predictors

    # ------------------------------------------------------------------
    # decide()
    # ------------------------------------------------------------------

    def decide(self, metrics: Dict[str, Any]) -> Dict[str, Any]:
        camera_name = metrics.get("camera_name", metrics.get("intersection_id", "unknown"))
        vehicle_counts: Dict[str, Any] = metrics.get("vehicle_counts") or {}

        # ---- 1. Update predictors + build arrival forecasts ----------
        forecasts = self._build_forecasts(camera_name, vehicle_counts)
        if forecasts:
            # Don't clobber caller-provided forecasts (e.g., from a GBT layer).
            existing = metrics.get("arrival_forecasts") or {}
            merged = dict(forecasts)
            merged.update(existing)
            metrics = {**metrics, "arrival_forecasts": merged}

        # ---- 2. Consume corridor platoon boost for this camera -------
        boost_map, injection = self._corridor_boost(camera_name, vehicle_counts)
        if boost_map:
            metrics = {**metrics, "platoon_boost": boost_map}
        if injection:
            metrics = {**metrics, "_platoon_injection": injection}

        # ---- 3. Delegate to inner decision engine --------------------
        decision = self._inner.decide(metrics)

        # ---- 4. Detect platoon release from queue drop ---------------
        self._maybe_fire_platoon(camera_name, vehicle_counts, decision)

        # Propagate a short summary so callers / dashboards can see the
        # forecast/boost at a glance.
        if forecasts:
            decision.setdefault("forecasts", {
                a: round(vals[0] if vals else 0.0, 2) for a, vals in forecasts.items()
            })
        if boost_map:
            decision.setdefault("platoon_boost", {k: round(v, 2) for k, v in boost_map.items()})

        return decision

    # ------------------------------------------------------------------
    # Internals
    # ------------------------------------------------------------------

    def _build_forecasts(self, camera_name: str,
                         vehicle_counts: Dict[str, Any]) -> Dict[str, List[float]]:
        """Return ``{approach: [f_1, ..., f_H]}`` forecast matrix for MPC.

        Implements the outcome feedback loop (§3.11): for ensemble
        registries we call ``record_actual`` before the next update so the
        sub-model MAPE EMAs see each realised value and can re-weight
        online.
        """
        if self._predictors is None or HoltPredictor is None:
            return {}
        out: Dict[str, List[float]] = {}
        for approach, count in vehicle_counts.items():
            try:
                obs = float(count)
            except (TypeError, ValueError):
                continue
            pred = self._predictors.get(camera_name, approach)
            # Outcome feedback: score previous forecast against the new obs.
            if self._is_ensemble and hasattr(pred, "record_actual"):
                try:
                    if getattr(pred, "is_initialised", False):
                        pred.record_actual(obs)
                except Exception:
                    pass
            pred.update(obs)
            n = getattr(pred, "n_updates", 0)
            if n < FORECAST_WARMUP:
                series = [max(0.0, obs)] * MPC_HORIZON
            else:
                series = [pred.forecast(h=h) for h in range(1, MPC_HORIZON + 1)]
            out[approach] = series
        return out

    def _corridor_boost(self, camera_name: str,
                        vehicle_counts: Dict[str, Any]
                        ) -> Tuple[Dict[str, float], Dict[str, List[Tuple[int, float]]]]:
        """Return (scalar boost per approach, per-approach MPC spike schedule)."""
        if self._corridor_mgr is None:
            return {}, {}
        boost: Dict[str, float] = {}
        spikes: Dict[str, List[Tuple[int, float]]] = {}
        now = time.time()
        for approach in vehicle_counts.keys():
            try:
                b = float(self._corridor_mgr.get_platoon_boost(camera_name, approach))
            except Exception:
                b = 0.0
            if b > 0:
                boost[approach] = b
                # Project as an MPC spike. We ask the CorridorManager for
                # any active events and place them in the step closest to
                # their ETA. ``active_events`` returns snapshot dicts with
                # ``eta_in_s``.
                try:
                    for ev in self._corridor_mgr.active_events():
                        if ev.get("destination") != camera_name:
                            continue
                        if ev.get("direction") != approach.upper():
                            continue
                        eta_s = max(0.0, float(ev.get("eta_in_s", 0.0)))
                        step = int(round(eta_s / max(MPC_STEP_S, 1e-6)))
                        veh = float(ev.get("queue_size", 0)) * 0.6
                        spikes.setdefault(approach, []).append((step, veh))
                except Exception:
                    pass
        return boost, spikes

    def _maybe_fire_platoon(self, camera_name: str,
                            vehicle_counts: Dict[str, Any],
                            decision: Dict[str, Any]) -> None:
        if self._corridor_mgr is None:
            return
        action = decision.get("action", "")
        for approach, count in vehicle_counts.items():
            try:
                cur = float(count)
            except (TypeError, ValueError):
                continue
            key = (camera_name, approach.upper())
            prev = self._prev_queue.get(key, cur)
            drop = prev - cur
            # Only count drops that coincide with us actually serving this
            # approach — otherwise random dequeues would spuriously fire.
            if (drop >= PLATOON_DROP
                    and action in ("PRIORITIZE", "SWITCH_GREEN", "EXTEND_GREEN")):
                tgt = decision.get("target_roi")
                if tgt and tgt.upper() == approach.upper():
                    try:
                        self._corridor_mgr.on_platoon_released(
                            camera_name=camera_name,
                            direction=approach.upper(),
                            queue_size=int(prev),
                        )
                        _dbg_impl("agents/hybrid_orchestrator.py:_maybe_fire_platoon",
                                  "platoon_released",
                                  {"camera": camera_name, "direction": approach.upper(),
                                   "drop": drop, "prev": prev, "cur": cur})
                    except Exception:
                        pass
            self._prev_queue[key] = cur


__all__ = ["HybridOrchestrator"]
