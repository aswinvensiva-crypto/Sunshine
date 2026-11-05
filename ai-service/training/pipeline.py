"""
training/pipeline.py — Retraining coordinator for all Sunshine IQ modules.

Called by POST /v1/training/{module} (admin only via Express gateway).
Each run:
  1. Loads tenant's historical data (scoped by tenant_id + RLS).
  2. Trains the module's model.
  3. Evaluates against time-ordered test set.
  4. Checks gate_config thresholds.
  5. Registers in ai_models; activates only if gate passed.
  6. Writes evaluation report to docs/evaluation/.
  7. Keeps previous version for rollback.

Fail-safe: any exception in training does NOT crash the serving process.
Return value: dict with status, version, metrics, gate_passed, data_source.
"""

import os
import json
import psycopg2
from datetime import datetime
from pathlib import Path
from typing import Dict, Optional

# Gate configuration
GATE_CONFIG_PATH = os.path.join(
    os.path.dirname(os.path.dirname(__file__)), 'config', 'gate_config.json'
)

def _load_gate_config() -> Dict:
    try:
        with open(GATE_CONFIG_PATH) as f:
            return json.load(f)
    except Exception:
        return {}

def _get_conn(tenant_id: int):
    conn = psycopg2.connect(
        os.getenv('DATABASE_URL_APP', 'postgresql://sunshine_app:sunshine_app@localhost:5432/sunshine')
    )
    cur = conn.cursor()
    cur.execute("SELECT set_config('app.current_tenant_id', %s, false)", [str(tenant_id)])
    return conn

def _load_bookings(tenant_id: int, conn) -> list:
    cur = conn.cursor()
    cur.execute(
        '''SELECT id, guest_id, room_type_id, check_in, check_out, num_guests, nights,
                  total_amount, advance_paid, payment_status, payment_method,
                  status, source, created_at
           FROM bookings WHERE tenant_id = %s ORDER BY created_at''',
        [tenant_id]
    )
    cols = [d[0] for d in cur.description]
    return [dict(zip(cols, row)) for row in cur.fetchall()]


def run_training(
    tenant_id: int,
    module: str,
    seed: int = 42,
    data_source: str = 'synthetic',
) -> Dict:
    """
    Dispatch training for the given module and tenant.
    Returns result dict with: status, version, metrics, gate_passed, data_source, notes.
    """
    gate_config = _load_gate_config()
    result = {
        'module': module,
        'tenant_id': tenant_id,
        'data_source': data_source,
        'status': 'error',
        'version': None,
        'metrics': {},
        'gate_passed': False,
        'notes': '',
    }

    conn = None
    try:
        conn = _get_conn(tenant_id)

        if module == 'risk':
            result = _train_risk(tenant_id, conn, gate_config, seed, data_source)

        elif module == 'forecast':
            result = _train_forecast(tenant_id, conn, gate_config, seed, data_source)

        elif module == 'pricing':
            result = _train_pricing(tenant_id, conn, gate_config, seed, data_source)

        elif module == 'rag':
            result = _train_rag(tenant_id, conn, data_source)

        else:
            result['status'] = 'error'
            result['notes'] = f"Unknown module: {module}"

    except Exception as e:
        result['status'] = 'error'
        result['notes'] = str(e)
        print(f'[training] ERROR in {module} for tenant {tenant_id}: {e}')
    finally:
        if conn:
            conn.close()

    return result


def _train_risk(tenant_id: int, conn, gate_config: Dict, seed: int, data_source: str) -> Dict:
    """Train XGBoost risk model for a tenant."""
    import sys, os
    sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    import pandas as pd
    from risk.training import train_risk_model
    from registry.model_registry import register_and_activate, _model_dir, _sha256

    print(f'[training] Starting risk training for tenant {tenant_id}...')
    bookings = _load_bookings(tenant_id, conn)
    if not bookings:
        return {
            'module': 'risk', 'tenant_id': tenant_id, 'status': 'insufficient_data',
            'version': None, 'metrics': {}, 'gate_passed': False,
            'data_source': data_source, 'notes': 'No bookings found.',
        }

    df = pd.DataFrame(bookings)
    train_result = train_risk_model(
        tenant_id=tenant_id,
        bookings_df=df,
        data_source=data_source,
        seed=seed,
        gate_config=gate_config,
    )

    if train_result.get('status') == 'insufficient_data':
        return {
            'module': 'risk', 'tenant_id': tenant_id, 'status': 'insufficient_data',
            'version': None, 'metrics': {}, 'gate_passed': False,
            'data_source': data_source, 'notes': f'Only {train_result.get("n_samples", 0)} labeled samples.',
        }

    version = train_result['version']
    metrics = train_result.get('metrics', {})

    # Flatten metrics for gate check
    flat_metrics = {}
    for label, m in metrics.items():
        for k, v in m.items():
            if not isinstance(v, dict):
                flat_metrics[f'{label}_{k}'] = v
    # Use cancel_roc_auc as the primary gate metric
    flat_metrics['roc_auc'] = flat_metrics.get('cancel_roc_auc', 0.0)

    # Register cancel model (primary) in ai_models
    artifact_dir = _model_dir(tenant_id, 'risk_cancel', version)
    artifact_path = str(artifact_dir / 'model.pkl')
    try:
        checksum = _sha256(artifact_path)
    except Exception:
        checksum = 'unknown'

    gate_passed = register_and_activate(
        tenant_id=tenant_id,
        module='risk',
        version=version,
        metrics=flat_metrics,
        artifact_path=str(artifact_dir),
        checksum=checksum,
        data_source=data_source,
        gate_config=gate_config,
        conn=conn,
    )

    return {
        'module': 'risk', 'tenant_id': tenant_id, 'status': 'ok',
        'version': version, 'metrics': flat_metrics, 'gate_passed': gate_passed,
        'data_source': data_source,
        'notes': 'Risk model trained. Activate gate requires roc_auc >= 0.60 (synthetic data — not real-world performance).',
    }


def _train_forecast(tenant_id: int, conn, gate_config: Dict, seed: int, data_source: str) -> Dict:
    """
    'Training' for forecast = run_forecast for all room types and evaluate via rolling-origin backtest.
    Chronos is pretrained (zero-shot) so there is no weight training; evaluation is backtest accuracy.
    """
    import sys, os
    sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    import numpy as np
    import pandas as pd
    from forecast.engine import load_occupancy_history, seasonal_naive_forecast, run_chronos_forecast
    from evaluation.metrics import smape, interval_coverage
    from evaluation.reporter import write_report
    from evaluation.splitters import rolling_origin_splits

    cur = conn.cursor()
    cur.execute('SELECT id FROM room_types WHERE tenant_id = %s', [tenant_id])
    room_type_ids = [r[0] for r in cur.fetchall()]

    if not room_type_ids:
        return {
            'module': 'forecast', 'tenant_id': tenant_id, 'status': 'insufficient_data',
            'version': None, 'metrics': {}, 'gate_passed': False,
            'data_source': data_source, 'notes': 'No room types.',
        }

    version = f'chronos-t5-small-{datetime.utcnow().strftime("%Y%m%d")}'
    all_smapes = []
    all_coverages = []

    for rt_id in room_type_ids:
        history = load_occupancy_history(tenant_id, rt_id, conn)
        if len(history) < 60:
            continue

        # Rolling-origin backtest
        df_hist = pd.DataFrame({'date': history.index, 'occ': history.values})
        for train_df, test_df in rolling_origin_splits(df_hist, 'date', min_train_days=30, horizon_days=30, step_days=30):
            if len(train_df) < 15 or len(test_df) < 5:
                continue
            train_series = pd.Series(train_df['occ'].values, index=pd.DatetimeIndex(train_df['date']))
            quantiles = run_chronos_forecast(train_series, horizon=len(test_df))
            if quantiles is None:
                quantiles = seasonal_naive_forecast(train_series, horizon=len(test_df))

            actual = test_df['occ'].values
            predicted = quantiles[:, 1]  # p50
            lower = quantiles[:, 0]      # p10
            upper = quantiles[:, 2]      # p90

            s = smape(actual, predicted)
            cov = interval_coverage(actual, lower, upper)
            all_smapes.append(s)
            all_coverages.append(cov)

    if not all_smapes:
        return {
            'module': 'forecast', 'tenant_id': tenant_id, 'status': 'insufficient_data',
            'version': version, 'metrics': {}, 'gate_passed': False,
            'data_source': data_source, 'notes': 'Not enough history for backtest.',
        }

    metrics = {
        'mean_smape': float(np.mean(all_smapes)),
        'median_smape': float(np.median(all_smapes)),
        'mean_interval_coverage': float(np.mean(all_coverages)),
        'n_backtests': len(all_smapes),
    }
    # Gate key for forecast is smape
    metrics['smape'] = metrics['mean_smape']

    write_report('forecast', metrics, tenant_id, data_source, seed, version)

    # Register in ai_models (no artifact — Chronos is not saved, just re-loaded)
    from registry.model_registry import register_and_activate
    gate_passed = register_and_activate(
        tenant_id=tenant_id, module='forecast', version=version,
        metrics=metrics, artifact_path='pretrained:amazon/chronos-t5-small',
        checksum='pretrained', data_source=data_source,
        gate_config=gate_config, conn=conn,
    )

    return {
        'module': 'forecast', 'tenant_id': tenant_id, 'status': 'ok',
        'version': version, 'metrics': metrics, 'gate_passed': gate_passed,
        'data_source': data_source,
        'notes': 'Chronos-T5-Small zero-shot backtest complete. Synthetic data only.',
    }


def _train_pricing(tenant_id: int, conn, gate_config: Dict, seed: int, data_source: str) -> Dict:
    """
    Train XGBoost pricing model on historical accepted/realised rate data.
    Target = rate where occupancy outcome was >= 70% within 7 days (U-05 option a).
    """
    import sys, os
    sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    import numpy as np
    import pandas as pd
    import xgboost as xgb
    from evaluation.splitters import time_ordered_split
    from evaluation.reporter import write_report
    from registry.model_registry import save_model, register_and_activate, _sha256, _model_dir

    print(f'[training] Starting pricing training for tenant {tenant_id}...')
    cur = conn.cursor()

    # Load historical inventory + booking data to build training samples
    cur.execute(
        '''SELECT i.stay_date, i.room_type_id, i.rate, i.booked_units, i.total_units,
                  (SELECT COUNT(*) FROM bookings b2
                   WHERE b2.tenant_id = i.tenant_id AND b2.room_type_id = i.room_type_id
                     AND b2.check_in <= i.stay_date AND b2.check_out > i.stay_date
                     AND b2.created_at > i.stay_date - INTERVAL \'7 days\'
                     AND b2.status != \'cancelled\') AS pickup_7d
           FROM inventory i
           WHERE i.tenant_id = %s AND i.total_units > 0
           ORDER BY i.stay_date''',
        [tenant_id]
    )
    rows = cur.fetchall()
    if len(rows) < 50:
        return {
            'module': 'pricing', 'tenant_id': tenant_id, 'status': 'insufficient_data',
            'version': None, 'metrics': {}, 'gate_passed': False,
            'data_source': data_source, 'notes': f'Only {len(rows)} inventory rows.',
        }

    version = datetime.utcnow().strftime('%Y%m%d_%H%M%S')

    df = pd.DataFrame(rows, columns=['stay_date', 'room_type_id', 'rate', 'booked_units', 'total_units', 'pickup_7d'])
    df['stay_date'] = pd.to_datetime(df['stay_date'])
    df['occupancy'] = df['booked_units'] / df['total_units'].replace(0, 1)
    # Target: rate achieved when occupancy >= 70% (U-05)
    df_target = df[df['occupancy'] >= 0.7].copy()
    if len(df_target) < 30:
        df_target = df.copy()  # fallback: all rows

    df_target['day_of_week'] = df_target['stay_date'].dt.dayofweek
    df_target['month'] = df_target['stay_date'].dt.month
    df_target['season_index'] = df_target['month'].apply(
        lambda m: 2 if m in (10,11,12,1,2,3) else (1 if m in (4,5,6) else 0)
    )
    df_target['lead_days'] = 30  # placeholder; actual lead per booking not available in inventory

    FEAT = ['occupancy', 'day_of_week', 'season_index', 'pickup_7d']
    X = df_target[FEAT].fillna(0).values
    y = df_target['rate'].values

    train_df, val_df, test_df = time_ordered_split(df_target, 'stay_date', 0.7, 0.15)
    X_train = train_df[FEAT].fillna(0).values
    y_train = train_df['rate'].values
    X_test = test_df[FEAT].fillna(0).values
    y_test = test_df['rate'].values

    model = xgb.XGBRegressor(n_estimators=150, max_depth=4, learning_rate=0.08, random_state=seed, n_jobs=1)
    model.fit(X_train, y_train, verbose=False)

    y_pred = model.predict(X_test) if len(X_test) > 0 else np.array([])
    rmse = float(np.sqrt(np.mean((y_test - y_pred)**2))) if len(y_pred) > 0 else 9999.0
    mae = float(np.mean(np.abs(y_test - y_pred))) if len(y_pred) > 0 else 9999.0

    metrics = {
        'rmse': rmse, 'mae': mae,
        'n_train': len(X_train), 'n_test': len(X_test),
    }

    artifact = {'model': model, 'feature_cols': FEAT}
    artifact_dir = save_model(artifact, tenant_id, 'pricing', version, metrics, data_source)
    checksum = _sha256(str(_model_dir(tenant_id, 'pricing', version) / 'model.pkl'))

    gate_passed = register_and_activate(
        tenant_id=tenant_id, module='pricing', version=version,
        metrics=metrics, artifact_path=artifact_dir, checksum=checksum,
        data_source=data_source, gate_config=gate_config, conn=conn,
    )
    write_report('pricing', metrics, tenant_id, data_source, seed, version)

    return {
        'module': 'pricing', 'tenant_id': tenant_id, 'status': 'ok',
        'version': version, 'metrics': metrics, 'gate_passed': gate_passed,
        'data_source': data_source, 'notes': 'XGBoost pricing model. Target: occupancy >= 70% (U-05).',
    }


def _train_rag(tenant_id: int, conn, data_source: str) -> Dict:
    """
    'Training' for RAG = ingest synthetic policy docs + run 30-question evaluation.
    The retrieval model (multilingual-mpnet) is pretrained — no weight training.
    """
    import sys, os
    sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    from synthetic.policy_docs import SAMPLE_POLICIES
    from rag.embeddings import ingest_documents
    from rag.evaluation import run_rag_evaluation
    from evaluation.reporter import write_report
    from registry.model_registry import register_and_activate

    print(f'[training] Ingesting synthetic policy docs for tenant {tenant_id}...')
    stats = ingest_documents(tenant_id, SAMPLE_POLICIES, conn)

    print(f'[training] Running 30-question RAG evaluation...')
    metrics = run_rag_evaluation(tenant_id, conn)
    metrics['chunks_ingested'] = stats['inserted']
    # Gate key
    metrics['hit_rate_at_5'] = metrics.get('hit_rate_at_5', 0.0)

    gate_config = _load_gate_config()
    version = f'mpnet-v1-{datetime.utcnow().strftime("%Y%m%d")}'

    gate_passed = register_and_activate(
        tenant_id=tenant_id, module='rag', version=version,
        metrics=metrics, artifact_path='pretrained:paraphrase-multilingual-mpnet-base-v2',
        checksum='pretrained', data_source=data_source,
        gate_config=gate_config, conn=conn,
    )
    write_report('rag', metrics, tenant_id, data_source, 42, version)

    return {
        'module': 'rag', 'tenant_id': tenant_id, 'status': 'ok',
        'version': version, 'metrics': metrics, 'gate_passed': gate_passed,
        'data_source': data_source,
        'notes': f'Ingested {stats["inserted"]} chunks from synthetic policies. 30-question eval complete.',
    }
