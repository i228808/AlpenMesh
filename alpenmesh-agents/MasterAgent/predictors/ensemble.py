"""
ensemble.py — Weighted blend of forecasters with online MAPE re-weighting.

During incidents (incident_flag=True) the weight collapses fully to EWMA
because learned models (GBT, CNN-LSTM) break under distribution shift.

Online weight update (Hedge-style inverse-MAPE):
    On each observation, every sub-model's last forecast is compared
    against the true value. A per-model MAPE EMA is maintained. Weights
    are then set inversely proportional to MAPE, normalised to sum to 1.
    Models with better accuracy get more say — no retraining required.
"""
from __future__ import annotations
from typing import Dict, List, Optional
import threading

from .base import Forecaster
from .ewma import HoltPredictor


class SMAForecaster(Forecaster):
    """Simple Moving Average over the last ``window`` observations.

    Complements Holt DES in the ensemble: DES adapts fast to trends while
    SMA provides stability against noise. The MAPE re-weighting in
    EnsembleForecaster then shifts weight toward whichever is more accurate
    for the current demand pattern.
    """

    def __init__(self, window: int = 5):
        self._window = max(1, window)
        self._buf: list = []

    def update(self, observed: float) -> float:
        self._buf.append(float(observed))
        if len(self._buf) > self._window:
            self._buf.pop(0)
        return self.forecast()

    def forecast(self, h: int = 1) -> float:
        return sum(self._buf) / len(self._buf) if self._buf else 0.0

    def reset(self) -> None:
        self._buf.clear()

    @property
    def is_initialised(self) -> bool:
        return bool(self._buf)

    @property
    def n_updates(self) -> int:
        return len(self._buf)


# Small epsilon so a model with MAPE=0 doesn't dominate arithmetic.
_EPS_MAPE = 1e-3


class EnsembleForecaster(Forecaster):
    """
    Online MAPE-weighted blend of forecasters for one (camera, ROI).

    Add additional sub-models with ``add_model``; the default registry
    ships with only Holt DES so it degenerates to the single-model case
    until something like a GBT is plugged in.
    """

    def __init__(self, alpha: float = 0.3, beta: float = 0.1,
                 mape_ema_alpha: float = 0.1):
        self._ewma = HoltPredictor(alpha=alpha, beta=beta)
        self._models: List[Forecaster] = [self._ewma]
        self._names:  List[str]       = ["holt"]
        self._weights: List[float]    = [1.0]
        # Per-model last 1-step forecast (cached so ``record_actual`` can
        # compute the error without re-forecasting).
        self._last_forecast: List[float] = [0.0]
        # Per-model MAPE EMA for online re-weighting.
        self._mape_ema: List[float]      = [0.0]
        self._mape_ema_alpha: float      = float(mape_ema_alpha)
        self._incident_active = False

    # ------------------------------------------------------------------
    # Composition
    # ------------------------------------------------------------------

    def add_model(self, model: Forecaster, name: str = "other") -> None:
        """Register an additional sub-model. Initial weight is uniform."""
        self._models.append(model)
        self._names.append(name)
        self._weights.append(1.0)
        self._last_forecast.append(0.0)
        self._mape_ema.append(0.0)
        # Renormalise to uniform so adding a model doesn't skew the blend.
        n = len(self._models)
        self._weights = [1.0 / n] * n

    # ------------------------------------------------------------------
    # Forecast lifecycle
    # ------------------------------------------------------------------

    def set_incident(self, active: bool) -> None:
        self._incident_active = active

    def update(self, observed: float) -> float:
        for i, m in enumerate(self._models):
            m.update(observed)
            self._last_forecast[i] = m.forecast(h=1)
        return self.forecast(h=1)

    def forecast(self, h: int = 1) -> float:
        # During incidents, drop to the analytically robust baseline.
        if self._incident_active:
            return self._ewma.forecast(h)
        total_w = sum(self._weights)
        if total_w <= 0 or len(self._models) == 0:
            return self._ewma.forecast(h)
        blended = sum(w * m.forecast(h) for w, m in zip(self._weights, self._models)) / total_w
        return max(0.0, blended)

    def record_actual(self, actual: float) -> None:
        """Feed the realised value for the last 1-step forecast.

        Updates each model's MAPE EMA, then recomputes weights as
        inverse-MAPE normalised.
        """
        actual = float(actual)
        denom = max(abs(actual), 1e-6)
        a = self._mape_ema_alpha
        for i in range(len(self._models)):
            err = abs(self._last_forecast[i] - actual) / denom
            self._mape_ema[i] = (1.0 - a) * self._mape_ema[i] + a * err
        # Inverse-MAPE weights, normalised.
        inv = [1.0 / (m + _EPS_MAPE) for m in self._mape_ema]
        total = sum(inv)
        if total > 0:
            self._weights = [w / total for w in inv]

    # ------------------------------------------------------------------
    # Introspection
    # ------------------------------------------------------------------

    def weights(self) -> Dict[str, float]:
        """Return a name -> weight snapshot (useful for logging/dashboards)."""
        return {n: round(w, 4) for n, w in zip(self._names, self._weights)}

    def mape(self) -> Dict[str, float]:
        return {n: round(m, 4) for n, m in zip(self._names, self._mape_ema)}

    def reset(self) -> None:
        for m in self._models:
            m.reset()
        self._mape_ema = [0.0] * len(self._models)
        self._last_forecast = [0.0] * len(self._models)
        n = len(self._models) or 1
        self._weights = [1.0 / n] * len(self._models)

    @property
    def is_initialised(self) -> bool:
        return self._ewma.is_initialised

    @property
    def n_updates(self) -> int:
        """Forward the EWMA counter so callers can check warm-up state."""
        return self._ewma.n_updates


class EnsembleRegistry:
    """Thread-safe registry of EnsembleForecaster instances."""

    def __init__(self, alpha: float = 0.3, beta: float = 0.1):
        self._defaults = {"alpha": alpha, "beta": beta}
        self._forecasters: Dict[tuple, EnsembleForecaster] = {}
        self._lock = threading.Lock()

    def get(self, camera_name: str, direction: str) -> EnsembleForecaster:
        key = (camera_name, direction.upper())
        with self._lock:
            if key not in self._forecasters:
                f = EnsembleForecaster(**self._defaults)
                # SMA-5 as a second model: stable under noise, defers to Holt
                # under trend. MAPE re-weighting shifts blend automatically.
                f.add_model(SMAForecaster(window=5), name="sma5")
                self._forecasters[key] = f
            return self._forecasters[key]

    def set_incident_for_camera(self, camera_name: str, active: bool) -> None:
        with self._lock:
            for key, f in self._forecasters.items():
                if key[0] == camera_name:
                    f.set_incident(active)

    def __len__(self) -> int:
        return len(self._forecasters)
