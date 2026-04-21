"""
predictors.py — Holt's Double Exponential Smoothing

One HoltPredictor instance per camera-direction pair.
Produces 1-step and h-step forecasts for vehicle arrival counts,
feeding the `predicted_arrivals` term in the Tier-1 demand score.

Usage:
    predictor = HoltPredictor(alpha=0.3, beta=0.1)
    forecast = predictor.update(observed_count)
"""

from __future__ import annotations
import threading
from typing import Dict


class HoltPredictor:
    """
    Holt's double exponential smoothing (DES) predictor.

    State:
        level (L)  — smoothed estimate of the current value
        trend (T)  — smoothed estimate of the current slope

    Update equations:
        L_t = alpha * x_t  + (1 - alpha) * (L_{t-1} + T_{t-1})
        T_t = beta  * (L_t - L_{t-1}) + (1 - beta)  * T_{t-1}

    h-step forecast:
        F_{t+h} = L_t + h * T_t
    """

    def __init__(self, alpha: float = 0.3, beta: float = 0.1):
        """
        Args:
            alpha: Level smoothing factor ∈ (0, 1].
                   Higher → more weight on recent observations.
            beta:  Trend smoothing factor ∈ (0, 1].
                   Higher → trend adapts faster to recent changes.
        """
        if not (0 < alpha <= 1):
            raise ValueError(f"alpha must be in (0, 1], got {alpha}")
        if not (0 < beta <= 1):
            raise ValueError(f"beta must be in (0, 1], got {beta}")

        self.alpha = alpha
        self.beta = beta

        # Internal state — None until first observation
        self._level: float | None = None
        self._trend: float = 0.0
        self._n_updates: int = 0

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def update(self, observed: float) -> float:
        """
        Ingest a new observation and return the 1-step-ahead forecast.

        On the first call the level is initialised to `observed` and
        trend to 0 (cold start), so the first forecast == observed.

        Args:
            observed: The observed vehicle count for this timestep.

        Returns:
            1-step-ahead forecast (float).
        """
        observed = float(observed)

        if self._level is None:
            # Cold start: initialise with the first observation (trend unknown).
            self._level = observed
            self._trend = 0.0
            self._n_updates = 1
            return observed  # forecast for next step = current value

        # Second observation: seed trend from the first two samples (canonical
        # Holt DES warm-up). Without this, convergence takes ~10 updates.
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
        """
        Return the h-step-ahead forecast without updating state.

        Args:
            h: Forecast horizon (number of steps ahead). Default 1.

        Returns:
            F_{t+h} = level + h * trend, clipped to ≥ 0.
        """
        if self._level is None:
            return 0.0
        return max(0.0, self._level + h * self._trend)

    def reset(self) -> None:
        """Clear all state (useful for camera restarts / failure recovery)."""
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
        return (
            f"HoltPredictor(alpha={self.alpha}, beta={self.beta}, "
            f"level={self._level:.2f}, trend={self._trend:.2f}, "
            f"n={self._n_updates})"
            if self._level is not None
            else f"HoltPredictor(alpha={self.alpha}, beta={self.beta}, uninitialised)"
        )


class PredictorRegistry:
    """
    Thread-safe registry of HoltPredictor instances, keyed by
    (camera_name, direction) tuples.

    The master agent holds a single PredictorRegistry and looks up
    or auto-creates predictors on demand.
    """

    def __init__(self, alpha: float = 0.3, beta: float = 0.1):
        self._defaults = {"alpha": alpha, "beta": beta}
        self._predictors: Dict[tuple, HoltPredictor] = {}
        self._lock = threading.Lock()

    def get(self, camera_name: str, direction: str) -> HoltPredictor:
        """Return the predictor for (camera_name, direction), creating it if absent."""
        key = (camera_name, direction.upper())
        with self._lock:
            if key not in self._predictors:
                self._predictors[key] = HoltPredictor(**self._defaults)
            return self._predictors[key]

    def reset_camera(self, camera_name: str) -> None:
        """Reset all predictors for a given camera (e.g., after a failure)."""
        with self._lock:
            for key, pred in self._predictors.items():
                if key[0] == camera_name:
                    pred.reset()

    def update_hyperparams(self, alpha: float, beta: float) -> None:
        """Update alpha/beta for subsequently created predictors (not existing ones)."""
        self._defaults = {"alpha": alpha, "beta": beta}

    def __len__(self) -> int:
        return len(self._predictors)
