import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..'))

from fastapi import APIRouter, Depends, HTTPException
import psycopg2

from app.auth import get_tenant_id
from app.schemas import RiskScoreRequest, RiskScore
from risk.serving import score_bookings

router = APIRouter(tags=["risk"])


@router.post("/v1/risk/score")
async def score_risk(req: RiskScoreRequest, tenant_id: int = Depends(get_tenant_id)):
    conn = None
    try:
        conn = psycopg2.connect(
            os.getenv('DATABASE_URL_APP', 'postgresql://sunshine_app:sunshine_app@localhost:5432/sunshine')
        )
        cur = conn.cursor()
        cur.execute("SELECT set_config('app.current_tenant_id', %s, false)", [str(tenant_id)])

        # Fetch booking rows
        if not req.booking_ids:
            return {'scores': []}

        placeholders = ','.join(['%s'] * len(req.booking_ids))
        cur.execute(
            f'''SELECT id, guest_id, room_type_id, check_in, check_out, num_guests, nights,
                       total_amount, advance_paid, payment_method, status, source, created_at
                FROM bookings WHERE id IN ({placeholders}) AND tenant_id = %s''',
            req.booking_ids + [tenant_id],
        )
        cols = [d[0] for d in cur.description]
        booking_rows = [dict(zip(cols, row)) for row in cur.fetchall()]

        # Guest history
        if booking_rows:
            guest_ids = list(set(b['guest_id'] for b in booking_rows))
            ph2 = ','.join(['%s'] * len(guest_ids))
            cur.execute(
                f'''SELECT guest_id,
                           COUNT(*) FILTER (WHERE status = 'checked_out') AS prior_stays,
                           COUNT(*) FILTER (WHERE status = 'cancelled') AS prior_cancels
                    FROM bookings WHERE guest_id IN ({ph2}) AND tenant_id = %s
                    GROUP BY guest_id''',
                guest_ids + [tenant_id],
            )
            hist_rows = [dict(zip([d[0] for d in cur.description], r)) for r in cur.fetchall()]
        else:
            hist_rows = []

        scores = score_bookings(tenant_id, booking_rows, hist_rows, conn)
        return {'scores': scores}

    except Exception as e:
        raise HTTPException(status_code=500, detail={'code': 'SCORING_ERROR', 'message': str(e)})
    finally:
        if conn:
            conn.close()
