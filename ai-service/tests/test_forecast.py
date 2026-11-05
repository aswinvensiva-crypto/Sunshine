"""
tests/test_forecast.py — Unit tests for the forecast engine model-selection logic.

These tests mock the heavy ML libraries (timesfm, chronos, torch) so they run
quickly on any machine without GPU or model weights.
"""

import os
import sys
import types
import numpy as np
import pandas as pd
import pytest
from datetime import datetime, timedelta
from unittest.mock import patch, MagicMock

# Ensure ai-service root is on sys.path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))


# ── helpers ──────────────────────────────────────────────────────────────────

def _make_history(n_days: int = 120) -> pd.Series:
    """Create a realistic-looking occupancy history for testing."""
    np.random.seed(42)
    base = 0.55 + 0.15 * np.sin(np.linspace(0, 4 * np.pi, n_days))
    noise = np.random.normal(0, 0.05, n_days)
    occ = np.clip(base + noise, 0, 1)
    dates = pd.date_range(end=datetime.today(), periods=n_days, freq="D")
    return pd.Series(occ, index=dates)


# ── seasonal-naive (always available) ────────────────────────────────────────

class TestSeasonalNaiveForecast:
    """seasonal_naive_forecast should always work without any ML imports."""

    def test_returns_correct_shape(self):
        from forecast.engine import seasonal_naive_forecast

        history = _make_history(120)
        result = seasonal_naive_forecast(history, horizon=60)
        assert result.shape == (60, 3), f"Expected (60,3), got {result.shape}"

    def test_values_clipped_0_1(self):
        from forecast.engine import seasonal_naive_forecast

        history = _make_history(120)
        result = seasonal_naive_forecast(history, horizon=60)
        assert np.all(result >= 0) and np.all(result <= 1), "Values must be in [0,1]"

    def test_p10_le_p50_le_p90(self):
        from forecast.engine import seasonal_naive_forecast

        history = _make_history(120)
        result = seasonal_naive_forecast(history, horizon=60)
        assert np.all(result[:, 0] <= result[:, 1] + 1e-9), "p10 > p50"
        assert np.all(result[:, 1] <= result[:, 2] + 1e-9), "p50 > p90"


# ── model dispatcher (_select_forecast) ──────────────────────────────────────

class TestModelDispatcher:
    """_select_forecast should cascade models based on preferred_model."""

    def test_naive_mode_skips_ml(self):
        from forecast.engine import _select_forecast

        history = _make_history(120)
        quantiles, version = _select_forecast(history, 60, "naive")
        assert version == "seasonal-naive-fallback"
        assert quantiles.shape == (60, 3)

    @patch("forecast.engine.run_timesfm_forecast")
    @patch("forecast.engine.run_chronos_forecast")
    def test_timesfm_preferred_succeeds(self, mock_chronos, mock_timesfm):
        from forecast.engine import _select_forecast

        fake_q = np.random.rand(60, 3).clip(0, 1)
        mock_timesfm.return_value = fake_q

        history = _make_history(120)
        quantiles, version = _select_forecast(history, 60, "timesfm")

        mock_timesfm.assert_called_once()
        mock_chronos.assert_not_called()
        assert version == "timesfm-1.0-200m"
        np.testing.assert_array_equal(quantiles, fake_q)

    @patch("forecast.engine.run_timesfm_forecast", return_value=None)
    @patch("forecast.engine.run_chronos_forecast")
    def test_timesfm_fails_falls_to_chronos(self, mock_chronos, mock_timesfm):
        from forecast.engine import _select_forecast

        fake_q = np.random.rand(60, 3).clip(0, 1)
        mock_chronos.return_value = fake_q

        history = _make_history(120)
        quantiles, version = _select_forecast(history, 60, "timesfm")

        mock_timesfm.assert_called_once()
        mock_chronos.assert_called_once()
        assert version == "chronos-t5-small-v1"

    @patch("forecast.engine.run_timesfm_forecast", return_value=None)
    @patch("forecast.engine.run_chronos_forecast", return_value=None)
    def test_both_fail_falls_to_naive(self, mock_chronos, mock_timesfm):
        from forecast.engine import _select_forecast

        history = _make_history(120)
        quantiles, version = _select_forecast(history, 60, "timesfm")

        assert version == "seasonal-naive-fallback"
        assert quantiles.shape == (60, 3)

    @patch("forecast.engine.run_chronos_forecast")
    def test_chronos_preferred(self, mock_chronos):
        from forecast.engine import _select_forecast

        fake_q = np.random.rand(60, 3).clip(0, 1)
        mock_chronos.return_value = fake_q

        history = _make_history(120)
        quantiles, version = _select_forecast(history, 60, "chronos")
        assert version == "chronos-t5-small-v1"

    @patch("forecast.engine.run_chronos_forecast", return_value=None)
    def test_chronos_preferred_fails_to_naive(self, mock_chronos):
        from forecast.engine import _select_forecast

        history = _make_history(120)
        quantiles, version = _select_forecast(history, 60, "chronos")
        assert version == "seasonal-naive-fallback"


# ── env var switch ───────────────────────────────────────────────────────────

class TestEnvVarSwitch:
    """The FORECAST_MODEL env var should control the global default model."""

    def test_default_is_timesfm(self):
        """Without env var set, the module-level default should be 'timesfm'."""
        # Re-import to pick up the default
        import forecast.engine as fe

        assert fe._FORECAST_MODEL == os.getenv("FORECAST_MODEL", "timesfm").strip().lower()

    def test_env_override_chronos(self, monkeypatch):
        """Setting FORECAST_MODEL=chronos should change the module default."""
        monkeypatch.setenv("FORECAST_MODEL", "chronos")
        # Force reimport
        import importlib
        import forecast.engine as fe

        importlib.reload(fe)
        assert fe._FORECAST_MODEL == "chronos"

    def test_env_override_naive(self, monkeypatch):
        """Setting FORECAST_MODEL=naive should select seasonal-naive."""
        monkeypatch.setenv("FORECAST_MODEL", "naive")
        import importlib
        import forecast.engine as fe

        importlib.reload(fe)
        assert fe._FORECAST_MODEL == "naive"


# ── produce_forecast integration (mocked DB) ────────────────────────────────

class TestProduceForecast:
    """produce_forecast with a mocked database connection."""

    def _mock_conn(self, history: pd.Series):
        """Build a mock psycopg2 connection that returns the given history."""
        conn = MagicMock()
        cursor = MagicMock()
        conn.cursor.return_value = cursor

        # fetchall returns rows matching the inventory query shape
        rows = [
            (idx.date(), occ * 10, 10)  # booked_units, total_units
            for idx, occ in zip(history.index, history.values)
        ]
        cursor.fetchall.return_value = rows
        return conn

    @patch("forecast.engine.run_timesfm_forecast", return_value=None)
    @patch("forecast.engine.run_chronos_forecast", return_value=None)
    def test_insufficient_data(self, mock_c, mock_t):
        from forecast.engine import produce_forecast

        history = _make_history(10)  # fewer than MIN_HISTORY_DAYS
        conn = self._mock_conn(history)

        result = produce_forecast(1, 1, conn, preferred_model="naive")
        assert result["status"] == "insufficient_data"
        assert result["points"] == []

    @patch("forecast.engine.run_timesfm_forecast", return_value=None)
    @patch("forecast.engine.run_chronos_forecast", return_value=None)
    def test_ok_with_naive(self, mock_c, mock_t):
        from forecast.engine import produce_forecast

        history = _make_history(120)
        conn = self._mock_conn(history)

        result = produce_forecast(1, 1, conn, preferred_model="naive")
        assert result["status"] == "ok"
        assert len(result["points"]) == 60
        assert result["model_version"] == "seasonal-naive-fallback"

    @patch("forecast.engine.run_timesfm_forecast")
    def test_ok_with_timesfm(self, mock_timesfm):
        from forecast.engine import produce_forecast

        fake_q = np.random.rand(60, 3).clip(0, 1)
        mock_timesfm.return_value = fake_q
        history = _make_history(120)
        conn = self._mock_conn(history)

        result = produce_forecast(1, 1, conn, preferred_model="timesfm")
        assert result["status"] == "ok"
        assert result["model_version"] == "timesfm-1.0-200m"
        assert len(result["points"]) == 60
