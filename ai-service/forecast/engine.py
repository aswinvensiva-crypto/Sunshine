"""
forecast/engine.py — 60-day occupancy forecast with model-selection support.

Model priority (controlled by FORECAST_MODEL env var):
  1. "timesfm"  — Google TimesFM (GPU-accelerated, higher accuracy)
  2. "chronos"  — Amazon Chronos-T5-Small (CPU-only, zero-shot)
  3. seasonal-naive — deterministic fallback (always available)

Data source: daily occupancy rate from the inventory table.
  occupancy = booked_units / total_units  for each (room_type, date).

Insufficient data: return status='insufficient_data' if < MIN_HISTORY_DAYS of data.
Do NOT extrapolate from other tenants' data.
"""

import os
import sys
import numpy as np
import pandas as pd
from datetime import date, timedelta
from typing import List, Optional
import warnings
import logging

warnings.filterwarnings("ignore")
log = logging.getLogger(__name__)

MIN_HISTORY_DAYS = int(os.getenv("MIN_HISTORY_DAYS", "30"))
FORECAST_HORIZON = 60

# ---------------------------------------------------------------------------
# Resolve which model to prefer at startup.
# Env var FORECAST_MODEL: "timesfm" (default) | "chronos" | "naive"
# ---------------------------------------------------------------------------
_FORECAST_MODEL = os.getenv("FORECAST_MODEL", "timesfm").strip().lower()


# ── data loading ──────────────────────────────────────────────────────────────

def load_occupancy_history(tenant_id: int, room_type_id: int, conn) -> pd.Series:
    """
    Load daily occupancy rate for a room type from the inventory table.
    occupancy = booked_units / total_units
    Returns pd.Series indexed by date, sorted ascending.
    """
    cur = conn.cursor()
    cur.execute(
        """SELECT stay_date, booked_units, total_units
           FROM inventory
           WHERE tenant_id = %s AND room_type_id = %s AND total_units > 0
           ORDER BY stay_date""",
        [tenant_id, room_type_id],
    )
    rows = cur.fetchall()
    if not rows:
        return pd.Series(dtype=float)
    dates = [r[0] for r in rows]
    occ = [float(r[1]) / float(r[2]) for r in rows]
    return pd.Series(occ, index=pd.DatetimeIndex(dates)).clip(0, 1)


# ── TimesFM (GPU, higher accuracy) ───────────────────────────────────────────

def run_timesfm_forecast(
    history: pd.Series, horizon: int = FORECAST_HORIZON
) -> Optional[np.ndarray]:
    """
    Run Google TimesFM to produce quantile forecasts.
    Returns array of shape (horizon, 3) with [p10, p50, p90], or None on failure.
    """
    try:
        import timesfm  # type: ignore

        tfm = timesfm.TimesFm(
            context_len=min(512, len(history)),
            horizon_len=horizon,
            input_patch_len=32,
            output_patch_len=128,
            num_layers=20,
            model_dims=1280,
            backend="gpu",  # falls back internally if no GPU
        )
        tfm.load_from_checkpoint(repo_id="google/timesfm-1.0-200m")

        # TimesFM expects numpy array; returns (point_forecast, quantile_dict)
        point_forecast, quantile_dict = tfm.forecast(
            [history.values],
            freq=[1],  # daily
        )
        p50 = point_forecast[0][:horizon].clip(0, 1)

        # Extract quantiles if available; otherwise estimate from multiple runs
        if quantile_dict and 0.1 in quantile_dict:
            p10 = np.array(quantile_dict[0.1][0][:horizon]).clip(0, 1)
            p90 = np.array(quantile_dict[0.9][0][:horizon]).clip(0, 1)
        else:
            # Estimate uncertainty from historical residuals
            noise = np.std(history.values[-90:]) if len(history) >= 90 else 0.1
            p10 = (p50 - 1.28 * noise).clip(0, 1)
            p90 = (p50 + 1.28 * noise).clip(0, 1)

        return np.stack([p10, p50, p90], axis=1)  # (horizon, 3)

    except ImportError:
        log.info("[forecast] timesfm not installed; will try fallback")
        return None
    except Exception as e:
        log.warning("[forecast] TimesFM error: %s; will try fallback", e)
        return None


# ── Chronos-T5-Small (CPU, zero-shot) ────────────────────────────────────────

def run_chronos_forecast(
    history: pd.Series, horizon: int = FORECAST_HORIZON
) -> Optional[np.ndarray]:
    """
    Run Amazon Chronos-T5-Small to produce quantile forecasts.
    Returns array of shape (horizon, 3) with [p10, p50, p90], or None on failure.
    """
    try:
        import torch
        from chronos import ChronosPipeline  # type: ignore

        pipeline = ChronosPipeline.from_pretrained(
            "amazon/chronos-t5-small",
            device_map="cpu",
            torch_dtype=torch.float32,
        )

        context = torch.tensor(history.values, dtype=torch.float32).unsqueeze(0)

        # Generate 100 samples for quantile estimation
        forecast_samples = pipeline.predict(
            context,
            prediction_length=horizon,
            num_samples=100,
        )  # shape: (1, num_samples, horizon)

        samples = forecast_samples[0].numpy()  # (num_samples, horizon)
        p10 = np.percentile(samples, 10, axis=0).clip(0, 1)
        p50 = np.percentile(samples, 50, axis=0).clip(0, 1)
        p90 = np.percentile(samples, 90, axis=0).clip(0, 1)

        return np.stack([p10, p50, p90], axis=1)  # (horizon, 3)

    except ImportError:
        log.info("[forecast] chronos-forecasting not installed; using seasonal-naive fallback")
        return None
    except Exception as e:
        log.warning("[forecast] Chronos error: %s; using seasonal-naive fallback", e)
        return None


# ── Seasonal-naive baseline (always available) ───────────────────────────────

def seasonal_naive_forecast(
    history: pd.Series, horizon: int = FORECAST_HORIZON
) -> np.ndarray:
    """
    Seasonal-naive baseline: forecast = same day last year (period=365).
    Uncertainty bands estimated from historical residuals.
    """
    vals = history.values
    preds = []
    for h in range(horizon):
        idx = len(vals) - 365 + h
        if 0 <= idx < len(vals):
            preds.append(float(vals[idx]))
        elif len(vals) > 0:
            window = vals[-90:] if len(vals) >= 90 else vals
            preds.append(float(np.mean(window)))
        else:
            preds.append(0.5)

    p50 = np.array(preds).clip(0, 1)
    noise = np.std(vals[-90:]) if len(vals) >= 90 else 0.1
    p10 = (p50 - 1.28 * noise).clip(0, 1)
    p90 = (p50 + 1.28 * noise).clip(0, 1)
    return np.stack([p10, p50, p90], axis=1)


# ── Model dispatcher ─────────────────────────────────────────────────────────

def _select_forecast(
    history: pd.Series,
    horizon: int,
    preferred_model: str,
) -> tuple:
    """
    Try the preferred model first; cascade to fallbacks.
    Returns (quantiles_array, model_version_string).
    """
    if preferred_model == "timesfm":
        q = run_timesfm_forecast(history, horizon)
        if q is not None:
            return q, "timesfm-1.0-200m"
        # fallback → chronos
        q = run_chronos_forecast(history, horizon)
        if q is not None:
            return q, "chronos-t5-small-v1"
        return seasonal_naive_forecast(history, horizon), "seasonal-naive-fallback"

    elif preferred_model == "chronos":
        q = run_chronos_forecast(history, horizon)
        if q is not None:
            return q, "chronos-t5-small-v1"
        return seasonal_naive_forecast(history, horizon), "seasonal-naive-fallback"

    else:
        # "naive" or anything unrecognised → direct seasonal-naive
        return seasonal_naive_forecast(history, horizon), "seasonal-naive-fallback"


# ── Public API ────────────────────────────────────────────────────────────────

def produce_forecast(
    tenant_id: int,
    room_type_id: int,
    conn,
    model_version: str = "auto",
    data_source: str = "synthetic",
    preferred_model: Optional[str] = None,
) -> dict:
    """
    Produce a 60-day occupancy forecast for one room type.
    Returns a ForecastSeries-compatible dict.

    Args:
        preferred_model: Override the global FORECAST_MODEL env var for this
                         call.  Accepts "timesfm", "chronos", or "naive".
    """
    history = load_occupancy_history(tenant_id, room_type_id, conn)

    if len(history) < MIN_HISTORY_DAYS:
        return {
            "room_type_id": room_type_id,
            "points": [],
            "model_version": model_version if model_version != "auto" else "n/a",
            "data_source": data_source,
            "status": "insufficient_data",
        }

    chosen_model = (preferred_model or _FORECAST_MODEL).strip().lower()
    quantiles, resolved_version = _select_forecast(history, FORECAST_HORIZON, chosen_model)

    if model_version == "auto":
        model_version = resolved_version

    # Generate forecast dates
    today = date.today()
    forecast_dates = [today + timedelta(days=i + 1) for i in range(FORECAST_HORIZON)]

    # Persist to forecasts table
    cur = conn.cursor()
    for d, (p10, p50, p90) in zip(forecast_dates, quantiles):
        cur.execute(
            """INSERT INTO forecasts
                   (tenant_id, room_type_id, forecast_date, p10, p50, p90,
                    model_version, data_source)
               VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
               ON CONFLICT (tenant_id, room_type_id, forecast_date)
               DO UPDATE SET p10=EXCLUDED.p10, p50=EXCLUDED.p50, p90=EXCLUDED.p90,
                 model_version=EXCLUDED.model_version, generated_at=now()""",
            [
                tenant_id,
                room_type_id,
                d.isoformat(),
                round(float(p10) * 100, 2),
                round(float(p50) * 100, 2),
                round(float(p90) * 100, 2),
                model_version,
                data_source,
            ],
        )
    conn.commit()

    points = [
        {
            "date": d.isoformat(),
            "p10": round(float(p10) * 100, 2),
            "p50": round(float(p50) * 100, 2),
            "p90": round(float(p90) * 100, 2),
        }
        for d, (p10, p50, p90) in zip(forecast_dates, quantiles)
    ]

    return {
        "room_type_id": room_type_id,
        "points": points,
        "model_version": model_version,
        "data_source": data_source,
        "status": "ok",
    }
