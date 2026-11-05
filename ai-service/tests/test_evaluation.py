"""
test_evaluation.py — Unit tests for Sunshine IQ Evaluation Framework.
Covers metrics, splitters, baselines, and report generation.
"""
import json
import os
import shutil
import tempfile
import numpy as np
import pandas as pd
import pytest

from evaluation.metrics import (
    hit_rate_at_k,
    interval_coverage,
    mae,
    mape,
    pr_auc,
    precision_recall_f1,
    roc_auc,
    rmse,
    smape,
)
from evaluation.splitters import rolling_origin_splits, time_ordered_split
from evaluation.baselines import LeadTimeRiskBaseline, SeasonalNaiveForecaster
from evaluation.reporter import get_git_commit, write_report


class TestMetrics:
    def test_mape_basic(self):
        actual = np.array([100.0, 200.0])
        predicted = np.array([110.0, 180.0])
        # |100-110|/100 = 0.10, |200-180|/200 = 0.10 -> 10%
        assert abs(mape(actual, predicted) - 10.0) < 1e-4

    def test_mape_zero_handling(self):
        actual = np.array([0.0])
        predicted = np.array([5.0])
        # Should not raise ZeroDivisionError
        val = mape(actual, predicted)
        assert val > 0

    def test_smape_basic(self):
        actual = np.array([100.0])
        predicted = np.array([110.0])
        # 200 * 10 / 210 = 9.5238...
        assert abs(smape(actual, predicted) - 9.5238) < 0.01

    def test_smape_zero_division(self):
        actual = np.array([0.0, 0.0])
        predicted = np.array([0.0, 0.0])
        assert smape(actual, predicted) == 0.0

    def test_interval_coverage(self):
        actual = np.array([5.0, 15.0, 25.0, 35.0])
        lower = np.array([0.0, 10.0, 20.0, 20.0])
        upper = np.array([10.0, 20.0, 30.0, 30.0])
        # 35 is not in [20, 30], so 3 out of 4 covered = 0.75
        assert interval_coverage(actual, lower, upper) == 0.75
        assert interval_coverage(np.array([]), np.array([]), np.array([])) == 0.0

    def test_precision_recall_f1(self):
        y_true = np.array([1, 1, 0, 0, 1, 0])
        y_pred = np.array([1, 0, 0, 0, 1, 1])
        res = precision_recall_f1(y_true, y_pred)
        assert "precision" in res
        assert "recall" in res
        assert "f1" in res
        # True positives = 2, False positives = 1, False negatives = 1
        # precision = 2/3, recall = 2/3, f1 = 2/3
        assert abs(res["precision"] - (2 / 3)) < 1e-4
        assert abs(res["recall"] - (2 / 3)) < 1e-4
        assert abs(res["f1"] - (2 / 3)) < 1e-4

    def test_roc_auc_and_pr_auc(self):
        y_true = np.array([0, 0, 1, 1])
        y_scores = np.array([0.1, 0.4, 0.35, 0.8])
        r_auc = roc_auc(y_true, y_scores)
        p_auc = pr_auc(y_true, y_scores)
        assert 0.0 <= r_auc <= 1.0
        assert 0.0 <= p_auc <= 1.0

    def test_hit_rate_at_k(self):
        assert hit_rate_at_k([1, 2], [3, 2, 4], k=2) == 1.0
        assert hit_rate_at_k([1, 2], [3, 4, 5], k=2) == 0.0
        assert hit_rate_at_k([5], [1, 2, 3, 4, 5], k=5) == 1.0
        assert hit_rate_at_k([5], [1, 2, 3, 4, 5], k=4) == 0.0

    def test_rmse_and_mae(self):
        actual = np.array([10.0, 20.0, 30.0])
        predicted = np.array([12.0, 18.0, 33.0])
        # diffs: [2, -2, 3]
        # mae = (2 + 2 + 3) / 3 = 7/3 = 2.333...
        # rmse = sqrt((4 + 4 + 9) / 3) = sqrt(17/3) = 2.38047...
        assert abs(mae(actual, predicted) - (7.0 / 3.0)) < 1e-4
        assert abs(rmse(actual, predicted) - np.sqrt(17.0 / 3.0)) < 1e-4


class TestSplitters:
    def test_time_ordered_split(self):
        dates = pd.date_range("2024-01-01", periods=100, freq="D")
        df = pd.DataFrame({"date": dates, "val": range(100)}).sample(frac=1.0, random_state=42)

        train, val, test = time_ordered_split(df, date_col="date", train_ratio=0.7, val_ratio=0.15)
        assert len(train) == 70
        assert len(val) == 15
        assert len(test) == 15

        # Check chronology: max train date < min val date < min test date
        assert train["date"].max() < val["date"].min()
        assert val["date"].max() < test["date"].min()

    def test_rolling_origin_splits(self):
        dates = pd.date_range("2024-01-01", periods=200, freq="D")
        df = pd.DataFrame({"date": dates, "val": range(200)})

        splits = list(rolling_origin_splits(
            df,
            date_col="date",
            min_train_days=90,
            horizon_days=30,
            step_days=30,
        ))
        assert len(splits) > 0
        for train, test in splits:
            assert len(train) > 0
            assert len(test) > 0
            assert train["date"].max() < test["date"].min()


class TestBaselines:
    def test_seasonal_naive_forecaster(self):
        idx = pd.date_range("2023-01-01", periods=365, freq="D")
        series = pd.Series(100.0, index=idx)
        # Specific date with unique value
        series.loc[pd.Timestamp("2023-06-15")] = 250.0

        model = SeasonalNaiveForecaster()
        model.fit(series)

        # Query 1 year later (2024-06-15)
        preds = model.predict([pd.Timestamp("2024-06-15"), pd.Timestamp("2024-06-16")])
        assert preds[0] == 250.0
        assert preds[1] == 100.0

    def test_lead_time_risk_baseline(self):
        X = pd.DataFrame([
            {"lead_days": 10, "advance_paid": 1, "payment_method": "upi"},   # base 0.05
            {"lead_days": 40, "advance_paid": 0, "payment_method": "cash"},  # 0.05 + 0.2 + 0.15 + 0.1 = 0.50
        ])
        baseline = LeadTimeRiskBaseline()
        probs = baseline.predict_proba(X)
        assert abs(probs[0] - 0.05) < 1e-4
        assert abs(probs[1] - 0.50) < 1e-4

        preds = baseline.predict(X, threshold=0.3)
        assert preds[0] == 0
        assert preds[1] == 1


class TestReporter:
    def test_write_report_synthetic_and_real(self):
        temp_dir = tempfile.mkdtemp()
        try:
            # Test synthetic data report
            json_path, md_path = write_report(
                module="risk",
                metrics={"roc_auc": 0.825, "f1": 0.74},
                tenant_id=1,
                data_source="synthetic",
                seed=42,
                model_version="v1.0.0",
                notes="Synthetic test run",
                output_dir=temp_dir,
            )

            assert os.path.exists(json_path)
            assert os.path.exists(md_path)

            with open(json_path, "r", encoding="utf-8") as f:
                data = json.load(f)
            assert data["module"] == "risk"
            assert data["tenant_id"] == 1
            assert data["data_source"] == "synthetic"
            assert "SYNTHETIC DATA" in data["data_source_note"]
            assert data["metrics"]["roc_auc"] == 0.825

            with open(md_path, "r", encoding="utf-8") as f:
                md_content = f.read()
            assert "# Risk Evaluation Report" in md_content
            assert "**roc_auc:** 0.8250" in md_content
            assert "SYNTHETIC" in md_content

            # Test real data report
            json_real, _ = write_report(
                module="forecast",
                metrics={"smape": 12.4},
                tenant_id=2,
                data_source="real",
                seed=101,
                model_version="v2.0.0",
                output_dir=temp_dir,
            )
            with open(json_real, "r", encoding="utf-8") as f:
                real_data = json.load(f)
            assert "Real data" in real_data["data_source_note"]
        finally:
            shutil.rmtree(temp_dir, ignore_errors=True)
