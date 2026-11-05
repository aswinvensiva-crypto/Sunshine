"""
baselines.py — Baseline forecasters and risk heuristics for comparison.
"""
from typing import Optional
import numpy as np
import pandas as pd


class SeasonalNaiveForecaster:
    """Seasonal naive: forecast = same day last year (or last season)."""

    def __init__(self):
        self.history: Optional[pd.Series] = None

    def fit(self, history: pd.Series):
        self.history = history.copy()
        if not isinstance(self.history.index, pd.DatetimeIndex):
            self.history.index = pd.to_datetime(self.history.index)

    def predict(self, dates) -> np.ndarray:
        if self.history is None:
            raise ValueError("Model must be fitted before predict.")
        preds = []
        mean_val = float(self.history.mean()) if len(self.history) > 0 else 0.0
        for d in dates:
            d = pd.Timestamp(d)
            last_year = d - pd.DateOffset(years=1)
            if last_year in self.history.index:
                val = self.history.loc[last_year]
                if isinstance(val, (pd.Series, np.ndarray)):
                    val = val.mean()
                preds.append(float(val))
            else:
                preds.append(mean_val)
        return np.array(preds, dtype=float)


class LeadTimeRiskBaseline:
    """Simple heuristic: high risk if lead_days > 30 and advance_paid == 0."""

    def predict_proba(self, X: pd.DataFrame) -> np.ndarray:
        probs = []
        for _, row in X.iterrows():
            p = 0.05
            if row.get("lead_days", 0) > 30:
                p += 0.2
            if row.get("advance_paid", 1) == 0:
                p += 0.15
            if row.get("payment_method", "") == "cash":
                p += 0.1
            probs.append(min(p, 1.0))
        return np.array(probs, dtype=float)

    def predict(self, X: pd.DataFrame, threshold: float = 0.5) -> np.ndarray:
        """Return binary predictions based on probability threshold."""
        return (self.predict_proba(X) >= threshold).astype(int)
