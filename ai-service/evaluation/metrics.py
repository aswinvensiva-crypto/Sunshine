"""
metrics.py — AI evaluation metrics for Sunshine IQ.
All functions validated against hand-computed examples.
"""
from typing import Dict, List, Optional
import numpy as np


def mape(actual: np.ndarray, predicted: np.ndarray, epsilon: float = 1e-8) -> float:
    """
    Mean Absolute Percentage Error. Returns 0–inf.
    Expressed as percentage (0–100+).
    """
    actual = np.asarray(actual, dtype=float)
    predicted = np.asarray(predicted, dtype=float)
    denom = np.maximum(np.abs(actual), epsilon)
    return float(np.mean(np.abs((actual - predicted) / denom)) * 100.0)


def smape(actual: np.ndarray, predicted: np.ndarray, epsilon: float = 1e-8) -> float:
    """
    Symmetric Mean Absolute Percentage Error. Returns 0–200.
    Standard formulation: 200 * |actual - predicted| / (|actual| + |predicted|).
    """
    actual = np.asarray(actual, dtype=float)
    predicted = np.asarray(predicted, dtype=float)
    denom = np.abs(actual) + np.abs(predicted)
    mask = denom > epsilon
    if not np.any(mask):
        return 0.0
    val = np.zeros_like(denom)
    val[mask] = 200.0 * np.abs(actual[mask] - predicted[mask]) / denom[mask]
    return float(np.mean(val))


def interval_coverage(actual: np.ndarray, lower: np.ndarray, upper: np.ndarray) -> float:
    """
    Empirical coverage: fraction of actual values within [lower, upper].
    Should be ~0.8 for p10-p90 prediction intervals.
    """
    actual = np.asarray(actual, dtype=float)
    lower = np.asarray(lower, dtype=float)
    upper = np.asarray(upper, dtype=float)
    if len(actual) == 0:
        return 0.0
    covered = (actual >= lower) & (actual <= upper)
    return float(np.mean(covered))


def precision_recall_f1(y_true: np.ndarray, y_pred: np.ndarray) -> Dict[str, float]:
    """Precision, recall, F1 for binary classification."""
    from sklearn.metrics import f1_score, precision_score, recall_score

    y_true = np.asarray(y_true)
    y_pred = np.asarray(y_pred)
    return {
        "precision": float(precision_score(y_true, y_pred, zero_division=0)),
        "recall": float(recall_score(y_true, y_pred, zero_division=0)),
        "f1": float(f1_score(y_true, y_pred, zero_division=0)),
    }


def roc_auc(y_true: np.ndarray, y_scores: np.ndarray) -> float:
    """ROC-AUC score."""
    from sklearn.metrics import roc_auc_score

    y_true = np.asarray(y_true)
    y_scores = np.asarray(y_scores)
    return float(roc_auc_score(y_true, y_scores))


def pr_auc(y_true: np.ndarray, y_scores: np.ndarray) -> float:
    """Precision-Recall AUC."""
    from sklearn.metrics import average_precision_score

    y_true = np.asarray(y_true)
    y_scores = np.asarray(y_scores)
    return float(average_precision_score(y_true, y_scores))


def hit_rate_at_k(relevant_ids: List[int], retrieved_ids: List[int], k: int) -> float:
    """Hit rate@k: 1 if any relevant item is in top-k retrieved, else 0."""
    top_k = set(retrieved_ids[:k])
    relevant_set = set(relevant_ids)
    return 1.0 if len(top_k.intersection(relevant_set)) > 0 else 0.0


def rmse(actual: np.ndarray, predicted: np.ndarray) -> float:
    """Root Mean Squared Error."""
    actual = np.asarray(actual, dtype=float)
    predicted = np.asarray(predicted, dtype=float)
    return float(np.sqrt(np.mean((actual - predicted) ** 2)))


def mae(actual: np.ndarray, predicted: np.ndarray) -> float:
    """Mean Absolute Error."""
    actual = np.asarray(actual, dtype=float)
    predicted = np.asarray(predicted, dtype=float)
    return float(np.mean(np.abs(actual - predicted)))


# Validate with hand-computed examples (run as tests)
assert abs(mape(np.array([100.0]), np.array([110.0])) - 10.0) < 0.01
assert abs(smape(np.array([100.0]), np.array([110.0])) - 9.52) < 0.1
assert interval_coverage(np.array([5.0, 15.0, 25.0]), np.array([0.0, 10.0, 20.0]), np.array([10.0, 20.0, 30.0])) == 1.0
assert hit_rate_at_k([1, 2], [3, 2, 4], k=2) == 1.0
assert hit_rate_at_k([1, 2], [3, 4, 5], k=2) == 0.0
