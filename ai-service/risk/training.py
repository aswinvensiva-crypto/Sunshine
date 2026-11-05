"""
risk/training.py — XGBoost risk model training pipeline.

Two binary XGBoost classifiers:
  cancel_model: predicts P(booking is cancelled)
  noshow_model: predicts P(booking is no-show / walked-out without proper checkout)

Labels are derived from booking.status:
  cancel: status == 'cancelled'
  noshow: status == 'checked_out' AND advance_paid < 0.1 * total_amount (proxy for no-show)
  (This definition depends on the real schema — documented here per U-09)

Splitting: time-ordered (train/val/test), never random shuffle across time.
Calibration: isotonic regression on val set (so UI probabilities are meaningful).
"""

import os
import sys
from datetime import datetime
from typing import Dict, Tuple

import numpy as np
import pandas as pd
import xgboost as xgb
from sklearn.calibration import CalibratedClassifierCV
from sklearn.isotonic import IsotonicRegression
from sklearn.preprocessing import LabelBinarizer
from sklearn.metrics import roc_auc_score, average_precision_score

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from evaluation.splitters import time_ordered_split
from evaluation.metrics import roc_auc, pr_auc, precision_recall_f1
from evaluation.baselines import LeadTimeRiskBaseline
from evaluation.reporter import write_report
from registry.model_registry import save_model, register_and_activate, _sha256, _model_dir

try:
    from features import build_features, build_guest_history, leakage_test, FEATURE_COLS
except ImportError:
    from risk.features import build_features, build_guest_history, leakage_test, FEATURE_COLS


def derive_labels(df: pd.DataFrame) -> pd.DataFrame:
    """
    Derive binary labels from booking status.
    Label definitions documented here (U-09):
      - cancel: status == 'cancelled'
      - noshow: status == 'checked_out' AND advance_paid < 10% of total (proxy)
    Only rows with a definitive outcome (not 'confirmed' or 'checked_in') are labeled.
    """
    df = df.copy()
    df['label_cancel'] = (df['status'] == 'cancelled').astype(int)
    df['label_noshow'] = (
        (df['status'] == 'checked_out') & 
        (df['advance_paid'] < 0.1 * df['total_amount'].replace(0, np.nan).fillna(1))
    ).astype(int)
    # Include only rows with definitive outcomes
    df = df[df['status'].isin(['cancelled', 'checked_out'])]
    return df


def train_risk_model(
    tenant_id: int,
    bookings_df: pd.DataFrame,
    data_source: str = 'synthetic',
    seed: int = 42,
    gate_config: dict = None,
) -> Dict:
    """
    Train, calibrate, evaluate, and register risk models for a tenant.
    Returns dict with metrics and activation status.
    """
    # Leakage check
    leakage_test(bookings_df)
    
    # Derive labels
    labeled = derive_labels(bookings_df)
    if len(labeled) < 50:
        return {'status': 'insufficient_data', 'n_samples': len(labeled)}
    
    # Time-ordered split
    train_df, val_df, test_df = time_ordered_split(labeled, 'created_at', 0.7, 0.15)
    
    def build_xy(split_df, as_of=None):
        if len(split_df) == 0:
            return pd.DataFrame(columns=FEATURE_COLS), np.array([]), np.array([])
        if as_of is None:
            as_of = pd.to_datetime(split_df['created_at'].min())
        hist = build_guest_history(bookings_df, as_of)
        X = build_features(split_df, hist)
        return X, split_df['label_cancel'].values, split_df['label_noshow'].values
    
    X_train, y_cancel_train, y_noshow_train = build_xy(train_df)
    X_val,   y_cancel_val,   y_noshow_val   = build_xy(val_df, pd.to_datetime(val_df['created_at'].min()) if len(val_df) > 0 else None)
    X_test,  y_cancel_test,  y_noshow_test  = build_xy(test_df, pd.to_datetime(test_df['created_at'].min()) if len(test_df) > 0 else None)
    
    results = {}
    version = datetime.utcnow().strftime('%Y%m%d_%H%M%S')
    
    for label_name, (y_train, y_val, y_test) in [
        ('cancel', (y_cancel_train, y_cancel_val, y_cancel_test)),
        ('noshow', (y_noshow_train, y_noshow_val, y_noshow_test)),
    ]:
        # Class weighting
        pos = y_train.sum()
        neg = len(y_train) - pos
        scale_pos = neg / max(pos, 1)
        
        model = xgb.XGBClassifier(
            n_estimators=200, max_depth=4, learning_rate=0.05,
            scale_pos_weight=scale_pos, random_state=seed,
            eval_metric='logloss', use_label_encoder=False,
            n_jobs=1,
        )
        eval_set = [(X_val.values, y_val)] if len(X_val) > 0 else []
        model.fit(
            X_train.values, y_train,
            eval_set=eval_set,
            verbose=False,
        )
        
        # Isotonic calibration on val set
        if len(X_val) > 5 and y_val.sum() > 0:
            raw_val_probs = model.predict_proba(X_val.values)[:, 1]
            ir = IsotonicRegression(out_of_bounds='clip')
            ir.fit(raw_val_probs, y_val)
        else:
            ir = None
        
        # Evaluate on test set
        if len(X_test) > 0 and y_test.sum() > 0:
            test_probs_raw = model.predict_proba(X_test.values)[:, 1]
            test_probs = ir.transform(test_probs_raw) if ir else test_probs_raw
            auc = float(roc_auc_score(y_test, test_probs))
            pr = float(average_precision_score(y_test, test_probs))
        else:
            auc, pr = 0.0, 0.0
        
        # Baseline comparison
        baseline = LeadTimeRiskBaseline()
        baseline_probs = baseline.predict_proba(X_test) if len(X_test) > 0 else np.array([])
        baseline_auc = float(roc_auc_score(y_test, baseline_probs)) if (len(baseline_probs) > 0 and y_test.sum() > 0) else 0.0
        
        # Feature importance
        importance = {col: float(imp) for col, imp in zip(FEATURE_COLS, model.feature_importances_)}
        
        results[label_name] = {
            'roc_auc': auc,
            'pr_auc': pr,
            'baseline_roc_auc': baseline_auc,
            'n_train': len(y_train),
            'n_val': len(y_val),
            'n_test': len(y_test),
            'pos_rate_train': float(y_train.mean()) if len(y_train) > 0 else 0,
            'feature_importance': importance,
        }
        
        # Save artifact
        artifact = {'model': model, 'calibrator': ir, 'feature_cols': FEATURE_COLS}
        artifact_dir = save_model(
            artifact, tenant_id, f'risk_{label_name}', version,
            results[label_name], data_source
        )
    
    # Write evaluation report
    flat_metrics = {}
    for label, metrics in results.items():
        for k, v in metrics.items():
            if not isinstance(v, dict):
                flat_metrics[f'{label}_{k}'] = v
    
    write_report('risk', flat_metrics, tenant_id, data_source, seed, version)
    
    return {'status': 'ok', 'version': version, 'metrics': results, 'data_source': data_source}
