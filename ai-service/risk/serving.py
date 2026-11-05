"""
risk/serving.py — Risk model inference.
Loads the active model for a tenant and scores bookings.
Returns Factor[] for SHAP explanations.
"""
import os
import sys
from typing import List, Dict, Optional

import numpy as np
import pandas as pd
import shap

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

try:
    from registry.model_registry import load_model, get_active_version
except ImportError:
    from ..registry.model_registry import load_model, get_active_version

try:
    from features import build_features, build_guest_history, FEATURE_COLS
except ImportError:
    from risk.features import build_features, build_guest_history, FEATURE_COLS

BAND_THRESHOLDS = {'high': 0.5, 'medium': 0.25}  # default; tenant-configurable


def prob_to_band(prob: float, thresholds=None) -> str:
    t = thresholds or BAND_THRESHOLDS
    if prob >= t['high']: return 'high'
    if prob >= t['medium']: return 'medium'
    return 'low'


def shap_to_factors(shap_values: np.ndarray, feature_names: List[str], direction: str) -> List[Dict]:
    """Convert SHAP values to Factor[] objects for the API response."""
    HUMAN_NAMES = {
        'lead_days': 'Lead time', 'nights': 'Stay length', 'num_guests': 'Party size',
        'season_index': 'Season', 'day_of_week_checkin': 'Check-in day',
        'source_encoded': 'Booking source', 'payment_method_encoded': 'Payment method',
        'advance_ratio': 'Advance paid ratio', 'prior_stays': 'Prior stays',
        'prior_cancels': 'Prior cancellations',
    }
    factors = []
    # Sort by absolute SHAP value
    indices = np.argsort(np.abs(shap_values))[::-1][:5]
    for i in indices:
        sv = float(shap_values[i])
        if abs(sv) < 0.001: continue
        fname = feature_names[i]
        factors.append({
            'name': fname,
            'direction': 'up' if sv > 0 else 'down',
            'magnitude': round(abs(sv), 4),
            'human_text': f"{HUMAN_NAMES.get(fname, fname)} {'increases' if sv > 0 else 'decreases'} risk",
        })
    return factors


def score_bookings(
    tenant_id: int,
    booking_rows: List[Dict],  # raw booking dicts from DB
    prior_history_rows: List[Dict],
    conn,
    model_version: Optional[str] = None,
    data_source: str = 'synthetic',
) -> List[Dict]:
    """
    Score a list of bookings. Returns RiskScore[] objects.
    On model-not-found: returns unscored objects (fail-open per RK-005).
    """
    if not booking_rows:
        return []
    
    # Load model
    version = model_version or get_active_version(tenant_id, 'risk_cancel', conn)
    if not version:
        return [{'booking_id': b['id'], 'band': 'unscored', 'cancel_prob': 0.0, 'noshow_prob': 0.0,
                 'factors': [], 'recommended_advance': None, 'model_version': 'none', 'data_source': data_source}
                for b in booking_rows]
    
    try:
        cancel_artifact = load_model(tenant_id, 'risk_cancel', version)
        noshow_artifact = load_model(tenant_id, 'risk_noshow', version)
    except Exception as e:
        print(f'[risk] Model load error: {e}')
        return [{'booking_id': b['id'], 'band': 'unscored', 'cancel_prob': 0.0, 'noshow_prob': 0.0,
                 'factors': [], 'recommended_advance': None, 'model_version': version, 'data_source': data_source}
                for b in booking_rows]
    
    bookings_df = pd.DataFrame(booking_rows)
    hist_df = pd.DataFrame(prior_history_rows) if prior_history_rows else pd.DataFrame(columns=['guest_id','prior_stays','prior_cancels'])
    X = build_features(bookings_df, hist_df)
    
    cancel_model = cancel_artifact['model']
    cancel_cal = cancel_artifact['calibrator']
    noshow_model = noshow_artifact['model']
    noshow_cal = noshow_artifact['calibrator']
    
    # SHAP explainer
    try:
        explainer_c = shap.TreeExplainer(cancel_model)
        shap_vals_c = explainer_c.shap_values(X.values)
    except:
        shap_vals_c = None
    
    cancel_probs_raw = cancel_model.predict_proba(X.values)[:, 1]
    cancel_probs = cancel_cal.transform(cancel_probs_raw) if cancel_cal else cancel_probs_raw
    noshow_probs_raw = noshow_model.predict_proba(X.values)[:, 1]
    noshow_probs = noshow_cal.transform(noshow_probs_raw) if noshow_cal else noshow_probs_raw
    
    scores = []
    for i, booking in enumerate(booking_rows):
        cp = float(cancel_probs[i])
        np_ = float(noshow_probs[i])
        combined_prob = max(cp, np_)
        band = prob_to_band(combined_prob)
        
        # SHAP factors for cancel model
        factors = []
        if shap_vals_c is not None:
            factors = shap_to_factors(shap_vals_c[i], FEATURE_COLS, 'cancel')
        
        # Recommended advance for high-risk
        rec_advance = None
        if band == 'high':
            total = float(booking.get('total_amount', 0))
            already_paid = float(booking.get('advance_paid', 0))
            rec_advance = max(0, round(total * 0.5 - already_paid, 2))  # recommend 50% covered
        
        scores.append({
            'booking_id': booking['id'],
            'cancel_prob': round(cp, 4),
            'noshow_prob': round(np_, 4),
            'band': band,
            'factors': factors,
            'recommended_advance': rec_advance,
            'model_version': version,
            'data_source': data_source,
        })
    
    return scores
