/**
 * refunds.js — shared refund use-cases, used both directly (owner) and by the
 * approval executor (manager request approved by the owner). Result objects,
 * no throws for business failures.
 */
async function recordBookingRefund(client, { tenantId, bookingId, amount, method, reason, notes, userId }) {
  const cur = await client.query('SELECT * FROM bookings WHERE id=$1 AND tenant_id=$2 FOR UPDATE', [bookingId, tenantId]);
  if (!cur.rows[0]) return { ok: false, error: { code: 'BOOKING_NOT_FOUND', message: 'Booking not found' } };
  const advancePaid = Number(cur.rows[0].advance_paid);
  const requested = Number(amount);
  if (requested > advancePaid) {
    return { ok: false, error: { code: 'REFUND_EXCEEDS_PAID', message: `Refund (${requested}) cannot exceed amount collected (${advancePaid})` } };
  }
  await client.query(
    `UPDATE bookings SET refund_amount=$1, refund_status='pending', refund_reason=$2, refund_method=$3
      WHERE id=$4 AND tenant_id=$5`,
    [requested, reason, method || 'cash', bookingId, tenantId]
  );
  await client.query(
    `INSERT INTO payments (booking_id, type, amount, status, notes, processed_by)
     VALUES ($1, 'refund', $2, 'pending', $3, $4)`,
    [bookingId, requested, notes || null, userId]
  );
  return { ok: true, value: { refund_amount: requested, refund_status: 'pending' } };
}

function getRazorpay(tenant) {
  try {
    const Razorpay = require('razorpay');
    const s = tenant?.settings || {};
    const key_id = s.razorpay_key_id || process.env.RAZORPAY_KEY_ID;
    const key_secret = s.razorpay_key_secret || process.env.RAZORPAY_KEY_SECRET;
    if (!key_id || !key_secret) return null;
    return new Razorpay({ key_id, key_secret });
  } catch {
    return null;
  }
}

async function issueGatewayRefund(db, tenant, { bookingId, paymentId, amount }) {
  const rz = getRazorpay(tenant);
  if (!rz) return { ok: false, error: { code: 'GATEWAY_NOT_CONFIGURED', message: 'Razorpay is not configured for this resort' } };
  const own = await db.query('SELECT 1 FROM bookings WHERE id=$1 AND tenant_id=$2', [bookingId, tenant.id]);
  if (!own.rows[0]) return { ok: false, error: { code: 'BOOKING_NOT_FOUND', message: 'Booking not found' } };
  const refund = await rz.payments.refund(paymentId, { amount: Math.round(Number(amount) * 100) });
  await db.query(
    `INSERT INTO payment_transactions (booking_id, amount, gst_amount, payment_method, gateway_reference_token, status, tenant_id)
     VALUES ($1,$2,0,'razorpay',$3,'refunded',$4)`,
    [bookingId, amount, refund.id, tenant.id]
  );
  return { ok: true, value: { refund_id: refund.id } };
}

module.exports = { recordBookingRefund, issueGatewayRefund, getRazorpay };
