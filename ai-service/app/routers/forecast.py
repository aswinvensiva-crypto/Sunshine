import os, sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..'))

from fastapi import APIRouter, Depends, HTTPException
from app.auth import get_tenant_id
from app.schemas import ForecastRequest
from forecast.engine import produce_forecast
import psycopg2

router = APIRouter()

@router.post('/v1/forecast/run')
async def run_forecast(req: ForecastRequest, tenant_id: int = Depends(get_tenant_id)):
    conn = None
    try:
        conn = psycopg2.connect(os.getenv('DATABASE_URL_APP', 'postgresql://sunshine_app:sunshine_app@localhost:5432/sunshine'))
        cur = conn.cursor()
        cur.execute("SELECT set_config('app.current_tenant_id', %s, false)", [str(tenant_id)])
        
        # Get room types for this tenant
        if req.room_type_ids:
            ph = ','.join(['%s'] * len(req.room_type_ids))
            cur.execute(f'SELECT id FROM room_types WHERE tenant_id = %s AND id IN ({ph})', [tenant_id] + req.room_type_ids)
        else:
            cur.execute('SELECT id FROM room_types WHERE tenant_id = %s', [tenant_id])
        
        room_type_ids = [r[0] for r in cur.fetchall()]
        forecasts = [produce_forecast(tenant_id, rt_id, conn) for rt_id in room_type_ids]
        return {'forecasts': forecasts, 'status': 'ok'}
    except Exception as e:
        raise HTTPException(status_code=500, detail={'code': 'FORECAST_ERROR', 'message': str(e)})
    finally:
        if conn: conn.close()
