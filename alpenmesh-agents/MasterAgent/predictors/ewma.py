"""
ewma.py — Holt's Double Exponential Smoothing forecaster.

Ported verbatim from the original predictors.py so that existing
demand-score behavior is preserved as the baseline + incident fallback.
"""
from __future__ import annotations
import threading
from typing import Dict

from .base import Forecaster


class HoltPredictor(Forecaster):
    """
    Holt's double exponential smoothing (DES).

    L_t = alpha * x_t  + (1 - alpha) * (L_{t-1} + T_{t-1})
    T_t = beta  * (L_t - L_{t-1}) + (1 - beta)  * T_{t-1}
    F_{t+h} = L_t + h * T_t
    """

    def __init__(self, alpha: float = 0.3, beta: float = 0.1):
        if not (0 < alpha <= 1):
            raise ValueError(f"alpha must be in (0, 1], got {alpha}")
        if not (0 < beta <= 1):
            raise ValueError(f"beta must be in (0, 1], got {beta}")
        self.alpha = alpha
        self.beta = beta
        self._level: float | None = None
        self._trend: float = 0.0
        self._n_updates: int = 0

    def update(self, observed: float) -> float:
        observed = float(observed)
        # Cold start: first observation seeds the level, trend stays 0 (unknown slope).
        if self._level is None:
            self._level = observed
            self._trend = 0.0
            self._n_updates = 1
            return observed
        # Second observation: seed the trend from the first two samples so we
        # don't spend ~10 updates crawling out of T=0. This is the canonical
        # Hyndman initialisation recommendation for Holt DES.
        if self._n_updates == 1:
            self._trend = observed - self._level
            self._level = observed
            self._n_updates = 2
            return self.forecast(h=1)
        prev_level = self._level
        new_level = self.alpha * observed + (1.0 - self.alpha) * (prev_level + self._trend)
        new_trend = self.beta * (new_level - prev_level) + (1.0 - self.beta) * self._trend
        self._level = new_level
        self._trend = new_trend
        self._n_updates += 1
        return self.forecast(h=1)

    def forecast(self, h: int = 1) -> float:
        if self._level is None:
            return 0.0
        return max(0.0, self._level + h * self._trend)

    def reset(self) -> None:
        self._level = None
        self._trend = 0.0
        self._n_updates = 0

    @property
    def is_initialised(self) -> bool:
        return self._level is not None

    @property
    def n_updates(self) -> int:
        return self._n_updates

    def __repr__(self) -> str:
        if self._level is not None:
            return (f"HoltPredictor(alpha={self.alpha}, beta={self.beta}, "
                    f"level={self._level:.2f}, trend={self._trend:.2f}, n={self._n_updates})")
        return f"HoltPredictor(alpha={self.alpha}, beta={self.beta}, uninitialised)"


class PredictorRegistry:
    """Thread-safe registry keyed by (camera_name, direction)."""

    def __init__(self, alpha: float = 0.3, beta: float = 0.1):
        self._defaults = {"alpha": alpha, "beta": beta}
        self._predictors: Dict[tuple, HoltPredictor] = {}
        self._lock = threading.Lock()

    def get(self, camera_name: str, direction: str) -> HoltPredictor:
        key = (camera_name, direction.upper())
        with self._lock:
            if key not in self._predictors:
                self._predictors[key] = HoltPredictor(**self._defaults)
            return self._predictors[key]

    def reset_camera(self, camera_name: str) -> None:
        with self._lock:
            for key, pred in self._predictors.items():
                if key[0] == camera_name:
                    pred.reset()

    def update_hyperparams(self, alpha: float, beta: float) -> None:
        self._defaults = {"alpha": alpha, "beta": beta}

    def __len__(self) -> int:
        return len(self._predictors)
