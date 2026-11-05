import os, sys, json
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..'))
from fastapi import APIRouter, Depends, HTTPException
from app.auth import get_tenant_id
from app.schemas import PricingRequest
from pricing.model import suggest_rates
from datetime import date
import psycopg2

router = APIRouter()

@router.post('/v1/pricing/suggest')
async def suggest_pricing(req: PricingRequest, tenant_id: int = Depends(get_tenant_id)):
    conn = None
    try:
        conn = psycopg2.connect(os.getenv('DATABASE_URL_APP','postgresql://sunshine_app:sunshine_app@localhost:5432/sunshine'))
        cur = conn.cursor()
        cur.execute("SELECT set_config('app.current_tenant_id', %s, false)", [str(tenant_id)])
        from_date = date.fromisoformat(req.from_date)
        to_date = date.fromisoformat(req.to_date)
        suggestions = suggest_rates(tenant_id, req.room_type_id, from_date, to_date, conn)
        return {'suggestions': suggestions}
    except Exception as e:
        raise HTTPException(status_code=500, detail={'code': 'PRICING_ERROR', 'message': str(e)})
    finally:
        if conn: conn.close()
