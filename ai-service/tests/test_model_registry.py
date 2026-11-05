"""
test_model_registry.py — Unit tests for model registry and gate activation logic.
"""
import json
import os
import shutil
import tempfile
from unittest.mock import MagicMock
import pytest

from registry.model_registry import (
    _check_gate,
    get_active_version,
    load_gate_config,
    load_model,
    register_and_activate,
    save_model,
)


class DummyModel:
    def __init__(self, name: str):
        self.name = name

    def predict(self, x):
        return [self.name] * len(x)


class TestModelRegistry:
    def test_save_and_load_model_checksum_verified(self, monkeypatch):
        temp_dir = tempfile.mkdtemp()
        monkeypatch.setenv("ARTIFACT_ROOT", temp_dir)
        try:
            model = DummyModel("test_xgboost_v1")
            metrics = {"roc_auc": 0.85, "f1": 0.78}

            artifact_path = save_model(
                model=model,
                tenant_id=1,
                module="risk",
                version="v1.0.0",
                metrics=metrics,
                data_source="synthetic",
            )

            assert os.path.exists(os.path.join(artifact_path, "model.pkl"))
            assert os.path.exists(os.path.join(artifact_path, "meta.json"))
            assert os.path.exists(os.path.join(artifact_path, "sha256.txt"))

            # Load model and verify
            loaded = load_model(tenant_id=1, module="risk", version="v1.0.0")
            assert loaded.name == "test_xgboost_v1"

            # Verify checksum tampering triggers ValueError
            model_file = os.path.join(artifact_path, "model.pkl")
            with open(model_file, "ab") as f:
                f.write(b"corrupted_bytes")

            with pytest.raises(ValueError, match="Checksum mismatch"):
                load_model(tenant_id=1, module="risk", version="v1.0.0")
        finally:
            shutil.rmtree(temp_dir, ignore_errors=True)

    def test_check_gate_rules(self):
        gate_config = {
            "risk": {"roc_auc": {"min": 0.60}},
            "forecast": {"smape": {"max": 50.0}},
            "pricing": {"rmse": {"max": 2000.0}},
        }

        # Passing
        assert _check_gate({"roc_auc": 0.75}, gate_config, "risk") is True
        assert _check_gate({"smape": 25.0}, gate_config, "forecast") is True
        assert _check_gate({"rmse": 1500.0}, gate_config, "pricing") is True

        # Failing min threshold
        assert _check_gate({"roc_auc": 0.55}, gate_config, "risk") is False

        # Failing max threshold
        assert _check_gate({"smape": 55.0}, gate_config, "forecast") is False
        assert _check_gate({"rmse": 2500.0}, gate_config, "pricing") is False

        # Missing metric in results
        assert _check_gate({"accuracy": 0.9}, gate_config, "risk") is False

        # Unconfigured module
        assert _check_gate({"accuracy": 0.9}, gate_config, "unconfigured_mod") is False

    def test_load_gate_config(self):
        config = load_gate_config()
        assert "risk" in config
        assert "forecast" in config
        assert "pricing" in config
        assert "rag" in config
        assert config["risk"]["roc_auc"]["min"] == 0.60

    def test_register_and_activate_with_mock_conn(self):
        mock_conn = MagicMock()
        mock_cur = MagicMock()
        mock_conn.cursor.return_value = mock_cur

        gate_config = {"risk": {"roc_auc": {"min": 0.60}}}

        # Case 1: gate passes -> activated, deactivates old version
        passed = register_and_activate(
            tenant_id=1,
            module="risk",
            version="v1.0.0",
            metrics={"roc_auc": 0.75},
            artifact_path="/tmp/model",
            checksum="abc123hash",
            data_source="synthetic",
            gate_config=gate_config,
            conn=mock_conn,
        )
        assert passed is True
        # Verify deactivation query was called
        assert any("UPDATE ai_models SET is_active = false" in str(c) for c in mock_cur.execute.call_args_list)
        # Verify insert was called
        assert any("INSERT INTO ai_models" in str(c) for c in mock_cur.execute.call_args_list)
        mock_conn.commit.assert_called()

        # Case 2: gate fails -> not activated, does not deactivate old version
        mock_cur.reset_mock()
        mock_conn.reset_mock()
        failed = register_and_activate(
            tenant_id=1,
            module="risk",
            version="v2.0.0",
            metrics={"roc_auc": 0.45},
            artifact_path="/tmp/model2",
            checksum="def456hash",
            data_source="synthetic",
            gate_config=gate_config,
            conn=mock_conn,
        )
        assert failed is False
        # Deactivation should NOT be called
        assert not any("UPDATE ai_models SET is_active = false" in str(c) for c in mock_cur.execute.call_args_list)
        # But record should still be inserted with is_active = False
        assert any("INSERT INTO ai_models" in str(c) for c in mock_cur.execute.call_args_list)

    def test_get_active_version(self):
        mock_conn = MagicMock()
        mock_cur = MagicMock()
        mock_conn.cursor.return_value = mock_cur
        mock_cur.fetchone.return_value = ("v1.2.3",)

        version = get_active_version(tenant_id=5, module="risk", conn=mock_conn)
        assert version == "v1.2.3"

        mock_cur.fetchone.return_value = None
        assert get_active_version(tenant_id=5, module="risk", conn=mock_conn) is None
