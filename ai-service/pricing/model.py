"""
pricing/model.py — XGBoost Smart Pricing Advisor.

Target definition (U-05, option a): regress historical accepted/realised rates
where occupancy outcome was >= 70% within 7 days of check-in.
(This is the team-chosen definition documented here.)

Features:
  - forecast_p50: predicted 60-day p50 occupancy for the date
  - forecast_band: p90 - p10 (uncertainty)
  - lead_days: days until the date from today
  - day_of_week: 0=Mon..6=Sun
  - season_index: 0=low,1=shoulder,2=high
  - competitor_delta: (own rate - median competitor rate) / own rate; NaN=0
  - current_rate: current inventory rate
  - pickup_7d: bookings made in last 7 days for this date

Guardrails (per RID-17, tenant-configurable):
  - floor_rate: minimum allowed rate
  - ceiling_rate: maximum allowed rate
  - max_daily_pct_change: max % change from current_rate per suggestion
"""

import numpy as np
import pandas as pd
from datetime import date, timedelta, datetime
from typing import Dict, List, Optional, Tuple
import xgboost as xgb
import shap
from evaluation.reporter import write_report
from evaluation.splitters import time_ordered_split
from registry.model_registry import save_model

FEATURE_COLS = [
    'forecast_p50', 'forecast_band', 'lead_days', 'day_of_week',
    'season_index', 'competitor_delta', 'current_rate', 'pickup_7d'
]

DEFAULT_GUARDRAILS = {
    'floor_rate': 1000.0,
    'ceiling_rate': 20000.0,
    'max_daily_pct_change': 50.0,
}


def month_to_season(month: int) -> int:
    if month in (10, 11, 12, 1, 2, 3): return 2
    if month in (4, 5, 6): return 1
    return 0


def apply_guardrails(
    suggested_rate: float,
    current_rate: float,
    guardrails: Dict,
) -> Tuple[float, bool]:
    """
    Clamp suggested_rate to guardrails. Returns (clamped_rate, was_clamped).
    """
    clamped = suggested_rate
    floor_ = guardrails.get('floor_rate', DEFAULT_GUARDRAILS['floor_rate'])
    ceil_ = guardrails.get('ceiling_rate', DEFAULT_GUARDRAILS['ceiling_rate'])
    max_pct = guardrails.get('max_daily_pct_change', DEFAULT_GUARDRAILS['max_daily_pct_change'])
    
    if current_rate > 0:
        max_up = current_rate * (1 + max_pct / 100)
        max_down = current_rate * (1 - max_pct / 100)
        clamped = min(clamped, max_up)
        clamped = max(clamped, max_down)
    
    clamped = max(clamped, floor_)
    clamped = min(clamped, ceil_)
    
    was_clamped = abs(clamped - suggested_rate) > 0.01
    return round(clamped, 2), was_clamped


def build_pricing_features(
    target_dates: List[date],
    tenant_id: int,
    room_type_id: int,
    conn,
) -> pd.DataFrame:
    """Build feature matrix for pricing suggestions."""
    cur = conn.cursor()
    today = date.today()
    rows = []
    
    for d in target_dates:
        lead = (d - today).days
        dow = d.weekday()
        season = month_to_season(d.month)
        
        # Get forecast
        cur.execute(
            'SELECT p50, p10, p90 FROM forecasts WHERE tenant_id=%s AND room_type_id=%s AND forecast_date=%s',
            [tenant_id, room_type_id, d.isoformat()]
        )
        fc = cur.fetchone()
        fp50 = float(fc[0]) if fc else 50.0
        fband = float(fc[2] - fc[1]) if fc else 20.0
        
        # Current rate
        cur.execute(
            'SELECT rate FROM inventory WHERE tenant_id=%s AND room_type_id=%s AND stay_date=%s',
            [tenant_id, room_type_id, d.isoformat()]
        )
        inv = cur.fetchone()
        current_rate = float(inv[0]) if inv else 5000.0
        
        # Competitor delta
        cur.execute(
            'SELECT AVG(rate) FROM competitor_rates WHERE tenant_id=%s AND fetched_at > NOW() - INTERVAL \'7 days\'',
            [tenant_id]
        )
        comp = cur.fetchone()
        comp_median = float(comp[0]) if comp and comp[0] else None
        comp_delta = ((current_rate - comp_median) / comp_median) if comp_median else 0.0
        
        # Pickup (bookings for this date made in last 7 days)
        cur.execute(
            '''SELECT COUNT(*) FROM bookings
               WHERE tenant_id=%s AND room_type_id=%s AND check_in<=%s AND check_out>%s
               AND created_at > NOW() - INTERVAL \'7 days\'  AND status != \'cancelled\'  ''',
            [tenant_id, room_type_id, d.isoformat(), d.isoformat()]
        )
        pickup = cur.fetchone()[0] or 0
        
        rows.append({
            'date': d, 'forecast_p50': fp50, 'forecast_band': fband,
            'lead_days': lead, 'day_of_week': dow, 'season_index': season,
            'competitor_delta': comp_delta, 'current_rate': current_rate,
            'pickup_7d': float(pickup),
        })
    
    return pd.DataFrame(rows)


def suggest_rates(
    tenant_id: int,
    room_type_id: int,
    from_date: date,
    to_date: date,
    conn,
    guardrails: Dict = None,
    data_source: str = 'synthetic',
) -> List[Dict]:
    """
    Generate rate suggestions for a date range.
    Falls back to rule-based if no trained model exists.
    """
    from registry.model_registry import get_active_version, load_model
    
    target_dates = [from_date + timedelta(days=i) for i in range((to_date - from_date).days + 1)]
    features_df = build_pricing_features(target_dates, tenant_id, room_type_id, conn)
    X = features_df[FEATURE_COLS].fillna(0).values
    
    guardrails = guardrails or DEFAULT_GUARDRAILS
    version = get_active_version(tenant_id, 'pricing', conn)
    
    suggestions = []
    
    for i, row in features_df.iterrows():
        current_rate = row['current_rate']
        
        if version:
            try:
                artifact = load_model(tenant_id, 'pricing', version)
                model = artifact['model'] if isinstance(artifact, dict) and 'model' in artifact else artifact
                suggested = float(model.predict(X[i:i+1])[0])
                
                # SHAP explanation
                try:
                    explainer = shap.TreeExplainer(model)
                    sv = explainer.shap_values(X[i:i+1])[0]
                    factors = []
                    HUMAN = {
                        'forecast_p50': 'Occupancy forecast', 'forecast_band': 'Forecast uncertainty',
                        'lead_days': 'Lead time', 'day_of_week': 'Day of week', 'season_index': 'Season',
                        'competitor_delta': 'Competitor rate position', 'current_rate': 'Current rate',
                        'pickup_7d': 'Recent pickup pace',
                    }
                    for j, (col, val) in enumerate(zip(FEATURE_COLS, sv)):
                        if abs(val) > 0.5:
                            factors.append({
                                'name': col, 'direction': 'up' if val > 0 else 'down',
                                'magnitude': round(abs(val), 2),
                                'human_text': f"{HUMAN.get(col, col)} {'supports higher' if val > 0 else 'supports lower'} rate",
                            })
                    if not factors:
                        factors = [{'name': 'forecast_p50', 'direction': 'up' if row['forecast_p50'] > 60 else 'down',
                                    'magnitude': 1.0, 'human_text': f"Occupancy forecast {row['forecast_p50']:.0f}%"}]
                except:
                    factors = [{'name': 'model', 'direction': 'up', 'magnitude': 1.0, 'human_text': 'AI model suggestion'}]
            except:
                suggested = _rule_based_rate(row)
                factors = _rule_factors(row)
                version = 'rule-based'
        else:
            suggested = _rule_based_rate(row)
            factors = _rule_factors(row)
            version = 'rule-based'
        
        clamped_rate, was_clamped = apply_guardrails(suggested, current_rate, guardrails)
        if was_clamped:
            factors.append({'name': 'guardrail', 'direction': 'down' if clamped_rate < suggested else 'up',
                            'magnitude': abs(clamped_rate - suggested), 'human_text': 'Rate clamped by guardrail'})
        
        suggestions.append({
            'room_type_id': room_type_id,
            'date': row['date'].isoformat(),
            'suggested_rate': clamped_rate,
            'factors': factors,
            'clamped': was_clamped,
            'model_version': version,
        })
    
    # Persist to price_suggestions
    cur = conn.cursor()
    for s in suggestions:
        cur.execute(
            '''INSERT INTO price_suggestions
               (tenant_id, room_type_id, suggestion_date, suggested_rate, factors, clamped, model_version, data_source)
               VALUES (%s,%s,%s,%s,%s,%s,%s,%s)
               ON CONFLICT DO NOTHING''',
            [tenant_id, room_type_id, s['date'], s['suggested_rate'],
             __import__('json').dumps(s['factors']), s['clamped'], s['model_version'], data_source]
        )
    conn.commit()
    
    return suggestions


def _rule_based_rate(row: pd.Series) -> float:
    """Fallback rule-based rate: surge based on forecast occupancy."""
    base = row['current_rate'] or 5000.0
    occ = row['forecast_p50'] / 100
    if occ > 0.9: mult = 1.5
    elif occ > 0.75: mult = 1.25
    elif occ > 0.5: mult = 1.0
    elif occ > 0.3: mult = 0.9
    else: mult = 0.8
    return round(base * mult, 2)


def _rule_factors(row: pd.Series) -> List[Dict]:
    return [{
        'name': 'forecast_p50',
        'direction': 'up' if row['forecast_p50'] > 60 else 'down',
        'magnitude': abs(row['forecast_p50'] - 60) / 100,
        'human_text': f"Forecast occupancy {row['forecast_p50']:.0f}% drives rate {'up' if row['forecast_p50'] > 60 else 'down'}",
    }]
