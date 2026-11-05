"""
training router — POST /v1/training/{module}
Triggers a full training + evaluation + registration run for a module.
Long-running (60–300 s); called exclusively from Express via service token.
"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..'))

from fastapi import APIRouter, Depends, HTTPException, Path, status
from fastapi.concurrency import run_in_threadpool
from typing import Optional

from app.auth import get_tenant_id
from app.schemas import TrainingTriggerRequest

router = APIRouter(tags=["training"])

VALID_MODULES = {"risk", "forecast", "pricing", "rag"}


@router.post("/v1/training/{module}")
async def trigger_training(
    module: str = Path(..., description="Module to train: risk, forecast, pricing, or rag"),
    req: Optional[TrainingTriggerRequest] = None,
    tenant_id: int = Depends(get_tenant_id),
):
    """
    Trigger training pipeline for a given AI module.

    Steps performed:
    1. Load tenant data (tenant_id-scoped, RLS active)
    2. Train / evaluate the module model
    3. Check gate thresholds from config/gate_config.json
    4. Register in ai_models; activate only if gate passed
    5. Write evaluation report to docs/evaluation/
    6. Return {status, version, metrics, gate_passed, data_source, notes}

    NOTE: Results from synthetic data are PLUMBING / FEASIBILITY EVIDENCE ONLY.
    See DAT-002, EV-006. The 'gate_passed' flag reflects synthetic performance,
    not production readiness.
    """
    if module not in VALID_MODULES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={
                "code": "INVALID_MODULE",
                "message": f"Unknown module '{module}'. Valid: {sorted(VALID_MODULES)}",
            },
        )

    seed = req.seed if req and hasattr(req, 'seed') and req.seed else 42
    data_source = req.data_source if req and hasattr(req, 'data_source') and req.data_source else 'synthetic'

    # Import here to avoid circular imports at module load
    from training.pipeline import run_training

    try:
        # Training is CPU-bound + blocking DB ops — run in threadpool
        result = await run_in_threadpool(
            run_training,
            tenant_id=tenant_id,
            module=module,
            seed=seed,
            data_source=data_source,
        )
        return result

    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={"code": "TRAINING_ERROR", "message": str(e)},
        )
