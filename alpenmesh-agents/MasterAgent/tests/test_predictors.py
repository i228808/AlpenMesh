"""
tests/test_predictors.py — Unit tests for HoltPredictor and PredictorRegistry.
"""
import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest
from predictors import HoltPredictor, PredictorRegistry


class TestHoltPredictor:
    def test_cold_start_returns_first_observation(self):
        p = HoltPredictor(alpha=0.3, beta=0.1)
        result = p.update(10.0)
        assert result == 10.0

    def test_forecast_without_update_returns_zero(self):
        p = HoltPredictor()
        assert p.forecast() == 0.0

    def test_forecast_clips_to_zero(self):
        p = HoltPredictor(alpha=0.9, beta=0.9)
        p.update(10.0)
        p.update(0.0)
        p.update(0.0)
        # Trend should be negative; forecast(h=10) could go negative
        assert p.forecast(h=10) >= 0.0

    def test_increasing_series_positive_trend(self):
        p = HoltPredictor(alpha=0.5, beta=0.5)
        for v in [1, 2, 3, 4, 5, 6, 7, 8]:
            p.update(float(v))
        assert p.forecast(h=1) > 8.0

    def test_reset_clears_state(self):
        p = HoltPredictor()
        p.update(5.0)
        p.reset()
        assert not p.is_initialised
        assert p.n_updates == 0
        assert p.forecast() == 0.0

    def test_invalid_alpha_raises(self):
        with pytest.raises(ValueError):
            HoltPredictor(alpha=0.0)
        with pytest.raises(ValueError):
            HoltPredictor(alpha=1.1)

    def test_n_updates_increments(self):
        p = HoltPredictor()
        for i in range(5):
            p.update(float(i))
        assert p.n_updates == 5


class TestPredictorRegistry:
    def test_auto_creates_predictor(self):
        reg = PredictorRegistry(alpha=0.3, beta=0.1)
        p = reg.get("cam1", "UP")
        assert isinstance(p, HoltPredictor)

    def test_same_instance_returned(self):
        reg = PredictorRegistry()
        p1  = reg.get("cam1", "UP")
        p2  = reg.get("cam1", "UP")
        assert p1 is p2

    def test_different_directions_different_instances(self):
        reg = PredictorRegistry()
        up   = reg.get("cam1", "UP")
        down = reg.get("cam1", "DOWN")
        assert up is not down

    def test_direction_case_insensitive(self):
        reg = PredictorRegistry()
        up1 = reg.get("cam1", "UP")
        up2 = reg.get("cam1", "up")
        assert up1 is up2

    def test_reset_camera_clears_all_directions(self):
        reg = PredictorRegistry()
        reg.get("cam1", "UP").update(10.0)
        reg.get("cam1", "DOWN").update(5.0)
        reg.reset_camera("cam1")
        assert not reg.get("cam1", "UP").is_initialised
        assert not reg.get("cam1", "DOWN").is_initialised

    def test_len(self):
        reg = PredictorRegistry()
        reg.get("cam1", "UP")
        reg.get("cam1", "DOWN")
        reg.get("cam2", "UP")
        assert len(reg) == 3
