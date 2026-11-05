"""
model_registry.py — Model artifact registry with checksums and DB tracking.

Model artifacts stored at: artifacts/models/{tenant_id}/{module}/{version}/
  model.pkl — the trained model
  meta.json  — metadata: module, version, metrics, data_source, trained_at
  sha256.txt — checksum of model.pkl

A model is ACTIVATED only if its metrics pass the configured gate.
Gate thresholds are read from config (U-17) — no defaults presented as acceptable.
"""
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
from typing import Any, Dict, Optional
import joblib
import psycopg2

ARTIFACT_ROOT = os.getenv("ARTIFACT_ROOT", "artifacts/models")


def _model_dir(tenant_id: int, module: str, version: str) -> Path:
    return Path(ARTIFACT_ROOT) / str(tenant_id) / module / version


def _sha256(path: str) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()


def load_gate_config(config_path: Optional[str] = None) -> Dict:
    """Load gate config from JSON file."""
    if config_path is None:
        base_dir = Path(__file__).resolve().parent.parent
        config_path = str(base_dir / "config" / "gate_config.json")
    with open(config_path, "r", encoding="utf-8") as f:
        return json.load(f)


def save_model(
    model: Any,
    tenant_id: int,
    module: str,
    version: str,
    metrics: Dict,
    data_source: str,
) -> str:
    """Save model artifact + metadata. Returns artifact directory path."""
    d = _model_dir(tenant_id, module, version)
    d.mkdir(parents=True, exist_ok=True)
    model_path = str(d / "model.pkl")
    joblib.dump(model, model_path)
    checksum = _sha256(model_path)
    with open(d / "sha256.txt", "w", encoding="utf-8") as f:
        f.write(checksum)
    meta = {
        "tenant_id": tenant_id,
        "module": module,
        "version": version,
        "metrics": metrics,
        "data_source": data_source,
        "trained_at": datetime.now(timezone.utc).isoformat(),
        "checksum": checksum,
    }
    with open(d / "meta.json", "w", encoding="utf-8") as f:
        json.dump(meta, f, indent=2)
    return str(d)


def load_model(tenant_id: int, module: str, version: str) -> Any:
    """Load and checksum-verify model artifact."""
    d = _model_dir(tenant_id, module, version)
    model_path = str(d / "model.pkl")
    expected = (d / "sha256.txt").read_text(encoding="utf-8").strip()
    actual = _sha256(model_path)
    if actual != expected:
        raise ValueError(f"Checksum mismatch for {module} v{version}: expected {expected}, got {actual}")
    return joblib.load(model_path)


def get_active_version(tenant_id: int, module: str, conn) -> Optional[str]:
    """Query DB for the active model version."""
    cur = conn.cursor()
    cur.execute(
        "SELECT version FROM ai_models WHERE tenant_id = %s AND model_type = %s AND is_active = true",
        [tenant_id, module],
    )
    row = cur.fetchone()
    return row[0] if row else None


def register_and_activate(
    tenant_id: int,
    module: str,
    version: str,
    metrics: Dict,
    artifact_path: str,
    checksum: str,
    data_source: str,
    gate_config: Dict,
    conn,
) -> bool:
    """
    Register model in DB. Activate it only if metrics pass the gate.
    Gate thresholds in gate_config come from config file (U-17).
    Returns True if activated, False if gate failed.
    """
    gate_passed = _check_gate(metrics, gate_config, module)
    cur = conn.cursor()
    # Deactivate current active if we're activating a new one
    if gate_passed:
        cur.execute(
            "UPDATE ai_models SET is_active = false WHERE tenant_id = %s AND model_type = %s AND is_active = true",
            [tenant_id, module],
        )
    cur.execute(
        """INSERT INTO ai_models
           (tenant_id, model_type, version, performance_metrics, artifact_path, artifact_checksum, data_source, is_active)
           VALUES (%s, %s, %s, %s, %s, %s, %s, %s)""",
        [tenant_id, module, version, json.dumps(metrics), artifact_path, checksum, data_source, gate_passed],
    )
    conn.commit()
    return gate_passed


def _check_gate(metrics: Dict, gate_config: Dict, module: str) -> bool:
    """
    Check if metrics pass the configured gate.
    gate_config example: {"risk": {"roc_auc": {"min": 0.6}}}
    If no gate configured for this module, ALWAYS returns False (safe default: require explicit config).
    """
    module_gate = gate_config.get(module)
    if not module_gate:
        print(f"  [registry] No gate configured for {module} — not activating (U-17)")
        return False
    for metric_name, threshold in module_gate.items():
        val = metrics.get(metric_name)
        if val is None:
            print(f'  [registry] Gate metric "{metric_name}" not in results — gate FAILED')
            return False
        if "min" in threshold and val < threshold["min"]:
            print(f'  [registry] Gate FAILED: {metric_name}={val:.4f} < min={threshold["min"]}')
            return False
        if "max" in threshold and val > threshold["max"]:
            print(f'  [registry] Gate FAILED: {metric_name}={val:.4f} > max={threshold["max"]}')
            return False
    return True
