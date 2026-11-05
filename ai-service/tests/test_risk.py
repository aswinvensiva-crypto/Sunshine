"""
test_risk.py — Unit tests for XGBoost Booking Risk Scorer components.
Tests feature engineering, leakage prevention, label derivation, and inference fail-open.
"""
from unittest.mock import MagicMock
import numpy as np
import pandas as pd
import pytest

from risk.features import (
    FEATURE_COLS,
    build_features,
    build_guest_history,
    leakage_test,
    month_to_season,
)
from risk.training import derive_labels
from risk.serving import prob_to_band, score_bookings, shap_to_factors


class TestRiskFeatures:
    def test_month_to_season(self):
        # India resort seasons: Oct-Mar=high(2), Apr-Jun=shoulder(1), Jul-Sep=low(0)
        for m in (10, 11, 12, 1, 2, 3):
            assert month_to_season(m) == 2
        for m in (4, 5, 6):
            assert month_to_season(m) == 1
        for m in (7, 8, 9):
            assert month_to_season(m) == 0

    def test_leakage_test_passes(self):
        df = pd.DataFrame({"dummy": [1, 2, 3]})
        assert leakage_test(df) is True

    def test_build_features_output_columns_and_shapes(self):
        bookings_df = pd.DataFrame([
            {
                "id": 1,
                "guest_id": 101,
                "check_in": "2026-11-10",
                "created_at": "2026-11-01",
                "nights": 3,
                "num_guests": 2,
                "source": "booking.com",
                "payment_method": "card",
                "total_amount": 10000.0,
                "advance_paid": 5000.0,
            },
            {
                "id": 2,
                "guest_id": 102,
                "check_in": "2026-05-01",
                "created_at": "2026-04-20",
                "nights": 1,
                "num_guests": 1,
                "source": "walk-in",
                "payment_method": "cash",
                "total_amount": 3000.0,
                "advance_paid": 0.0,
            },
        ])

        hist_df = pd.DataFrame([
            {"guest_id": 101, "prior_stays": 2, "prior_cancels": 1},
        ])

        X = build_features(bookings_df, hist_df)
        assert list(X.columns) == FEATURE_COLS
        assert len(X) == 2

        # Verify values for first booking
        row0 = X.iloc[0]
        assert row0["lead_days"] == 9.0
        assert row0["season_index"] == 2.0  # November is high
        assert row0["source_encoded"] == 1.0  # booking.com is 1
        assert row0["payment_method_encoded"] == 1.0  # card is 1
        assert row0["advance_ratio"] == 0.5
        assert row0["prior_stays"] == 2.0
        assert row0["prior_cancels"] == 1.0

        # Verify default guest history for guest 102
        row1 = X.iloc[1]
        assert row1["prior_stays"] == 0.0
        assert row1["prior_cancels"] == 0.0

    def test_build_guest_history_temporal_leakage_prevented(self):
        bookings = pd.DataFrame([
            # Past bookings
            {"guest_id": 1, "created_at": "2026-01-01", "status": "checked_out"},
            {"guest_id": 1, "created_at": "2026-02-01", "status": "cancelled"},
            # Future booking after cutoff
            {"guest_id": 1, "created_at": "2026-04-01", "status": "checked_out"},
        ])
        as_of = pd.Timestamp("2026-03-01")
        hist = build_guest_history(bookings, as_of)

        assert len(hist) == 1
        row = hist.iloc[0]
        assert row["guest_id"] == 1
        assert row["prior_stays"] == 1  # Only 1 before as_of
        assert row["prior_cancels"] == 1


class TestRiskTraining:
    def test_derive_labels(self):
        df = pd.DataFrame([
            {"id": 1, "status": "cancelled", "advance_paid": 0, "total_amount": 5000},
            {"id": 2, "status": "checked_out", "advance_paid": 0, "total_amount": 5000},  # proxy noshow
            {"id": 3, "status": "checked_out", "advance_paid": 2000, "total_amount": 5000},  # standard checkout
            {"id": 4, "status": "confirmed", "advance_paid": 1000, "total_amount": 5000},  # active - excluded
        ])
        labeled = derive_labels(df)
        assert len(labeled) == 3
        assert set(labeled["id"]) == {1, 2, 3}

        row1 = labeled[labeled["id"] == 1].iloc[0]
        assert row1["label_cancel"] == 1
        assert row1["label_noshow"] == 0

        row2 = labeled[labeled["id"] == 2].iloc[0]
        assert row2["label_cancel"] == 0
        assert row2["label_noshow"] == 1

        row3 = labeled[labeled["id"] == 3].iloc[0]
        assert row3["label_cancel"] == 0
        assert row3["label_noshow"] == 0


class TestRiskServing:
    def test_prob_to_band(self):
        assert prob_to_band(0.7) == "high"
        assert prob_to_band(0.5) == "high"
        assert prob_to_band(0.3) == "medium"
        assert prob_to_band(0.25) == "medium"
        assert prob_to_band(0.1) == "low"

    def test_score_bookings_fail_open_no_model(self):
        mock_conn = MagicMock()
        mock_cur = MagicMock()
        mock_conn.cursor.return_value = mock_cur
        mock_cur.fetchone.return_value = None  # No active model

        bookings = [
            {"id": 10, "guest_id": 1, "total_amount": 10000, "advance_paid": 1000},
        ]
        scores = score_bookings(
            tenant_id=1,
            booking_rows=bookings,
            prior_history_rows=[],
            conn=mock_conn,
        )
        assert len(scores) == 1
        assert scores[0]["booking_id"] == 10
        assert scores[0]["band"] == "unscored"
        assert scores[0]["cancel_prob"] == 0.0
        assert scores[0]["model_version"] == "none"

    def test_shap_to_factors(self):
        shap_values = np.array([0.25, -0.15, 0.0005, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0])
        factors = shap_to_factors(shap_values, FEATURE_COLS, "cancel")
        assert len(factors) == 2  # 0.0005 is < 0.001
        assert factors[0]["name"] == "lead_days"
        assert factors[0]["direction"] == "up"
        assert factors[0]["magnitude"] == 0.25
        assert factors[1]["name"] == "nights"
        assert factors[1]["direction"] == "down"
        assert factors[1]["magnitude"] == 0.15
