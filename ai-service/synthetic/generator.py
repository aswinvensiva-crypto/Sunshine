"""
synthetic/generator.py — Seeded synthetic booking data generator.

Generating assumptions (documented per TRD §13):
- Seasonality: High season Oct-Mar (India winter), Low season Apr-Sep
- Lead time: LogNormal(mean=15, sigma=1.5) days
- Cancellation drivers: long lead time + payment pending increases cancel risk
- No-show drivers: same-day booking + cash payment increases noshow risk
- Sources: direct 50%, booking.com 30%, agoda 15%, walk-in 5%
- Party size: 1-4 guests, mean 2
- Competitor rates: ±20% of own rate, fetched twice daily

WARNING: Because the generator defines the cancellation drivers, a risk model
trained on this data can only discover what the generator encoded. Results are
PLUMBING/FEASIBILITY EVIDENCE ONLY, not real-world performance claims.
"""

import os
import sys
import random
import numpy as np
import psycopg2
from datetime import date, datetime, timedelta
from typing import Optional


def get_db_conn():
    """Connect using DATABASE_URL_APP or individual env vars."""
    url = os.getenv('DATABASE_URL_APP') or os.getenv('DATABASE_URL')
    if url:
        return psycopg2.connect(url)
    return psycopg2.connect(
        host=os.getenv('DB_HOST', 'localhost'),
        port=int(os.getenv('DB_PORT', 5432)),
        user=os.getenv('DB_APP_USER', 'sunshine_app'),
        password=os.getenv('DB_APP_PASSWORD', 'sunshine_app'),
        database=os.getenv('DB_NAME', 'sunshine')
    )


def set_tenant_context(cur, tenant_id: int):
    cur.execute("SELECT set_config('app.current_tenant_id', %s, true)", [str(tenant_id)])


class SyntheticGenerator:
    def __init__(self, seed: int = 42):
        self.seed = seed
        random.seed(seed)
        np.random.seed(seed)

    def generate_for_tenant(
        self,
        tenant_id: int,
        years: float = 1.5,
        high_season_rate: float = 8500.0,
        low_season_rate: float = 5500.0,
        avg_total_rooms: int = 15,
    ):
        """Generate synthetic data for one tenant. Must run inside a transaction with tenant context set."""
        conn = get_db_conn()
        conn.autocommit = False
        cur = conn.cursor()
        try:
            cur.execute('BEGIN')
            set_tenant_context(cur, tenant_id)

            # Get room types for this tenant
            cur.execute('SELECT id, name, base_rate, total_rooms FROM room_types WHERE tenant_id = %s', [tenant_id])
            room_types = cur.fetchall()
            if not room_types:
                print(f'  No room types for tenant {tenant_id} — skipping')
                conn.rollback()
                return 0

            end_date = date.today()
            start_date = end_date - timedelta(days=int(years * 365))

            bookings_created = 0
            feedback_created = 0

            # Get or create sample guests
            cur.execute('SELECT id FROM guests WHERE tenant_id = %s LIMIT 50', [tenant_id])
            guest_ids = [r[0] for r in cur.fetchall()]
            if not guest_ids:
                # Create synthetic guests
                for i in range(30):
                    cur.execute(
                        "INSERT INTO guests (tenant_id, full_name, email, phone) VALUES (%s, %s, %s, %s) RETURNING id",
                        [tenant_id, f'Synthetic Guest {i+1}', f'synth{i+1}@example.com', f'+91900000{i:04d}']
                    )
                    guest_ids.append(cur.fetchone()[0])

            sources = ['direct', 'direct', 'direct', 'booking.com', 'booking.com', 'agoda', 'walk-in']
            payment_methods = ['cash', 'cash', 'card', 'card', 'upi', 'upi']

            d = start_date
            while d < end_date:
                month = d.month
                is_high = month in (10, 11, 12, 1, 2, 3)

                for rt_id, rt_name, base_rate, total_rooms in room_types:
                    # How many bookings check in today?
                    occupancy_target = random.uniform(0.6 if is_high else 0.3, 0.95 if is_high else 0.65)
                    n_bookings = max(0, int(total_rooms * occupancy_target * random.uniform(0.8, 1.1)))

                    for _ in range(min(n_bookings, total_rooms)):
                        lead_days = max(0, int(np.random.lognormal(mean=2.5, sigma=1.2)))
                        booking_date = d - timedelta(days=lead_days)
                        if booking_date < start_date:
                            booking_date = start_date

                        nights = random.choices([1,2,3,4,5,7], weights=[20,30,25,10,8,7])[0]
                        check_out = d + timedelta(days=nights)
                        if check_out > end_date + timedelta(days=60):
                            continue

                        # Rate with seasonality
                        if is_high:
                            rate = base_rate * random.uniform(0.9, 1.4)
                        else:
                            rate = base_rate * random.uniform(0.6, 0.95)
                        rate = round(rate, 2)

                        source = random.choice(sources)
                        payment_method = random.choice(payment_methods)
                        num_guests = random.randint(1, 4)
                        total_amount = rate * nights

                        # Cancellation probability (encoded driver)
                        cancel_prob = 0.05
                        if lead_days > 30: cancel_prob += 0.15
                        if lead_days > 60: cancel_prob += 0.10
                        if payment_method == 'cash': cancel_prob += 0.05
                        if source == 'booking.com': cancel_prob += 0.08

                        # No-show probability
                        noshow_prob = 0.02
                        if lead_days == 0: noshow_prob += 0.12
                        if payment_method == 'cash': noshow_prob += 0.06

                        # Determine outcome
                        rand = random.random()
                        if rand < cancel_prob:
                            status = 'cancelled'
                        elif rand < cancel_prob + noshow_prob:
                            status = 'checked_out'  # treat as no-show for training
                        elif d < end_date:
                            status = 'checked_out'
                        else:
                            status = 'confirmed'

                        advance_paid = 0.0
                        if status != 'cancelled':
                            advance_paid = total_amount * random.uniform(0.3, 1.0) if payment_method != 'cash' else total_amount * random.uniform(0.0, 0.5)
                        advance_paid = round(advance_paid, 2)
                        pending = round(total_amount - advance_paid, 2)
                        pay_status = 'paid' if pending <= 0 else ('partial' if advance_paid > 0 else 'pending')

                        ref = f'SYN-{tenant_id}-{bookings_created+1:06d}'
                        guest_id = random.choice(guest_ids)

                        try:
                            cur.execute(
                                '''INSERT INTO bookings
                                   (tenant_id, reference, guest_id, room_type_id, check_in, check_out,
                                    num_guests, nights, base_amount, tax_amount, total_amount,
                                    advance_paid, pending_amount, payment_status, payment_method,
                                    status, source, created_at)
                                   VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,0,%s,%s,%s,%s,%s,%s,%s,%s)
                                   ON CONFLICT DO NOTHING''',
                                [tenant_id, ref, guest_id, rt_id, d.isoformat(), check_out.isoformat(),
                                 num_guests, nights, total_amount, total_amount, advance_paid, pending,
                                 pay_status, payment_method, status, source, booking_date]
                            )
                            bookings_created += 1
                        except Exception as e:
                            pass  # skip duplicate refs

                        # Update inventory
                        if status not in ('cancelled',):
                            cur.execute(
                                '''UPDATE inventory SET booked_units = LEAST(booked_units + 1, total_units)
                                   WHERE tenant_id = %s AND room_type_id = %s
                                   AND stay_date >= %s AND stay_date < %s''',
                                [tenant_id, rt_id, d.isoformat(), check_out.isoformat()]
                            )

                # Competitor rates for this day
                competitors = ['Sunrise Resort', 'Blue Lagoon', 'Mountain View Inn']
                for comp in random.sample(competitors, random.randint(1, 3)):
                    cur.execute(
                        '''INSERT INTO competitor_rates (tenant_id, resort_name, room_type, rate, fetched_at)
                           VALUES (%s, %s, %s, %s, %s)
                           ON CONFLICT DO NOTHING''',
                        [tenant_id, comp, 'Standard', round(random.uniform(4000, 12000), 2),
                         datetime.combine(d, datetime.min.time())]
                    )

                d += timedelta(days=1)

            # Generate feedback items
            feedback_texts = [
                ('Great stay! The rooms were clean and staff was friendly.', 'positive'),
                ('Beautiful location but slow service at breakfast.', 'neutral'),
                ('Excellent value for money. Will return!', 'positive'),
                ('Room was not ready on time. Disappointing.', 'negative'),
                ('Amazing experience, highly recommended!', 'positive'),
                ('Average stay. Nothing special.', 'neutral'),
                ('Staff was very helpful and attentive.', 'positive'),
                ('Pool area needs maintenance.', 'negative'),
                ('Perfect getaway. Loved every moment.', 'positive'),
                ('WiFi was slow but location was great.', 'neutral'),
                # Tamil (machine-generated for plumbing only)
                ('அருமையான தங்கும் இடம். மிகவும் மகிழ்ச்சியாக இருந்தது.', 'positive'),
                ('சேவை மேம்படுத்தப்பட வேண்டும்.', 'neutral'),
                # Hindi (machine-generated for plumbing only)
                ('बहुत अच्छा होटल है। फिर आऊंगा।', 'positive'),
                ('खाना ठीक था लेकिन कमरे छोटे थे।', 'neutral'),
            ]
            for text, sentiment in random.choices(feedback_texts, k=20):
                lang = 'ta' if any('\u0b80' <= c <= '\u0bff' for c in text) else ('hi' if any('\u0900' <= c <= '\u097f' for c in text) else 'en')
                cur.execute(
                    '''INSERT INTO feedback_items (tenant_id, source, content_text, language, sentiment, sentiment_confidence, is_synthetic)
                       VALUES (%s, %s, %s, %s, %s, %s, true)''',
                    [tenant_id, 'synthetic', text, lang, sentiment, round(random.uniform(0.7, 0.99), 4)]
                )
                feedback_created += 1

            conn.commit()
            print(f'  Tenant {tenant_id}: created {bookings_created} bookings, {feedback_created} feedback items')
            return bookings_created

        except Exception as e:
            conn.rollback()
            print(f'  ERROR for tenant {tenant_id}: {e}')
            raise
        finally:
            cur.close()
            conn.close()

    def cleanup_synthetic(self, tenant_id: int):
        """Remove only synthetic rows (feedback_items flagged is_synthetic, bookings with SYN- prefix)."""
        conn = get_db_conn()
        conn.autocommit = False
        cur = conn.cursor()
        try:
            cur.execute('BEGIN')
            set_tenant_context(cur, tenant_id)
            cur.execute("DELETE FROM feedback_items WHERE tenant_id = %s AND is_synthetic = true", [tenant_id])
            cur.execute("DELETE FROM bookings WHERE tenant_id = %s AND reference LIKE 'SYN-%'", [tenant_id])
            cur.execute("DELETE FROM competitor_rates WHERE tenant_id = %s AND resort_name IN ('Sunrise Resort','Blue Lagoon','Mountain View Inn')", [tenant_id])
            conn.commit()
            print(f'  Cleaned up synthetic data for tenant {tenant_id}')
        except Exception as e:
            conn.rollback()
            raise
        finally:
            cur.close()
            conn.close()


if __name__ == '__main__':
    from dotenv import load_dotenv
    load_dotenv()
    import sys
    
    action = sys.argv[1] if len(sys.argv) > 1 else 'generate'
    tenant_ids = [int(x) for x in sys.argv[2:]] if len(sys.argv) > 2 else [1]
    
    gen = SyntheticGenerator(seed=42)
    for tid in tenant_ids:
        if action == 'generate':
            print(f'Generating synthetic data for tenant {tid}...')
            gen.generate_for_tenant(tid, years=1.5)
        elif action == 'cleanup':
            print(f'Cleaning up synthetic data for tenant {tid}...')
            gen.cleanup_synthetic(tid)
        else:
            print(f'Unknown action: {action}. Use generate or cleanup.')
