"""
agents/mode_selector.py — Routes each decision to MPC or Max-Pressure.

Selection rules:
  1. Active incident on any approach → Max-Pressure (forecasts unreliable)
  2. Forecast MAPE > 40% over last 15 min → Max-Pressure
  3. MPC demoted (consecutive solver failures) → Max-Pressure
  4. Otherwise → MPC
"""
from __future__ import annotations
import os
import time
from typing import Any, Dict, Optional, Set

from .base import MasterAgentBase
from .mpc import MpcAgent
from .maxpressure import MaxPressureAgent

try:
    from observability.debug_log import dbg as _dbg_impl
except Exception:  # pragma: no cover
    def _dbg_impl(location, message, data=None):
        return

_DBG_LAST_ROI: Dict[str, str] = {}
def _dbg(location, message, data=None):
    _dbg_impl(location, message, data)

MAPE_THRESHOLD = float(40.0)


class ModeSelector(MasterAgentBase):
    """Selects between MPC and Max-Pressure per intersection per cycle."""

    def __init__(self, mpc: Optional[MpcAgent] = None,
                 maxpressure: Optional[MaxPressureAgent] = None):
        self._mpc = mpc or MpcAgent()
        self._maxpressure = maxpressure or MaxPressureAgent()
        self._active_incidents: Dict[str, float] = {}  # intersection → expiry
        self._forecast_mape: Dict[str, float] = {}     # intersection → MAPE

    def set_incident(self, intersection_id: str, expires_at: float) -> None:
        self._active_incidents[intersection_id] = expires_at

    def clear_expired_incidents(self) -> None:
        now = time.time()
        expired = [k for k, v in self._active_incidents.items() if now > v]
        for k in expired:
            del self._active_incidents[k]

    def update_mape(self, intersection_id: str, mape: float) -> None:
        self._forecast_mape[intersection_id] = mape

    def decide(self, metrics: Dict[str, Any]) -> Dict[str, Any]:
        intersection_id = metrics.get("camera_name", metrics.get("intersection_id", "unknown"))
        self.clear_expired_incidents()

        # Rule 1: incident active
        if intersection_id in self._active_incidents:
            decision = self._maxpressure.decide(metrics)
            decision["mode_reason"] = "incident_active"
            return decision

        # Rule 2: high forecast MAPE
        mape = self._forecast_mape.get(intersection_id, 0.0)
        if mape > MAPE_THRESHOLD:
            decision = self._maxpressure.decide(metrics)
            decision["mode_reason"] = f"high_mape ({mape:.1f}%)"
            return decision

        # Rule 3: MPC demoted
        if self._mpc.is_demoted(intersection_id):
            decision = self._maxpressure.decide(metrics)
            decision["mode_reason"] = "mpc_demoted"
            return decision

        # Rule 4: MPC
        decision = self._mpc.decide(metrics)

        # If MPC returned fallback, use Max-Pressure
        if decision.get("mode") == "mpc_fallback":
            decision = self._maxpressure.decide(metrics)
            decision["mode_reason"] = "mpc_solver_fail"
            return decision

        decision["mode_reason"] = "mpc_optimal"
        # #region agent log
        _prev_roi = _DBG_LAST_ROI.get(intersection_id)
        _cur_roi  = decision.get("target_roi")
        _DBG_LAST_ROI[intersection_id] = _cur_roi
        _dbg("agents/mode_selector.py:decide", "chose_mode", {
            "hypothesisId": "H3",
            "intersection":  intersection_id,
            "mode_reason":   decision.get("mode_reason"),
            "target_roi":    _cur_roi,
            "prev_target_roi": _prev_roi,
            "flipped":       _prev_roi is not None and _prev_roi != _cur_roi,
            "vc_keys":       list((metrics.get("vehicle_counts") or {}).keys()),
            "sim_time":      metrics.get("_sim_time"),
        })
        # #endregion
        return decision

    def set_override(self, camera_name: str, action: str,
                     target_roi: Optional[str] = None, duration: int = 60) -> None:
        self._mpc.set_override(camera_name, action, target_roi, duration)

    def clear_override(self, camera_name: str) -> None:
        self._mpc.clear_override(camera_name)
