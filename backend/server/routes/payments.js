/**
 * payments.js — Razorpay gateway integration (tenant-scoped).
 * POST /api/payments/create-order  → creates Razorpay order tied to booking_id
 * POST /api/payments/verify        → validates signature + logs to payment_transactions
 * POST /api/payments/refund        → issues Razorpay refund + logs row
 *
 * Razorpay credentials come from tenant_settings (per resort), falling back
 * to the RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET env vars for the default
 * single-tenant deployment.
 */
const router = require('express').Router();
const crypto = require('crypto');
const { requireAuth } = require('../middleware/auth');

function razorpayKeys(req) {
  const s = req.tenant?.settings || {};
  return {
    key_id: s.razorpay_key_id || process.env.RAZORPAY_KEY_ID,
    key_secret: s.razorpay_key_secret || process.env.RAZORPAY_KEY_SECRET,
  };
}

/* Lazy-load Razorpay SDK so server still starts without the package installed */
function getRazorpay(req) {
  try {
    const Razorpay = require('razorpay');
    const { key_id, key_secret } = razorpayKeys(req);
    if (!key_id || !key_secret) return null;
    return new Razorpay({ key_id, key_secret });
  } catch {
    return null;
  }
}

/* POST /api/payments/create-order  { booking_id, amount } */
router.post('/create-order', requireAuth, async (req, res) => {
  const { booking_id, amount } = req.body || {};
  if (!booking_id || !amount) return res.status(400).json({ error: 'booking_id and amount are required' });

  const rz = getRazorpay(req);
  if (!rz) return res.status(503).json({ error: 'Razorpay is not configured for this resort' });

  try {
    const bk = await req.db.query(
      'SELECT id, total_amount, tax_amount FROM bookings WHERE id=$1 AND tenant_id=$2',
      [booking_id, req.tenant.id]
    );
    if (!bk.rows[0]) return res.status(404).json({ error: 'Booking not found' });

    const order = await rz.orders.create({
      amount:   Math.round(Number(amount) * 100), // Razorpay takes paise
      currency: 'INR',
      notes:    { booking_id: String(booking_id), tenant: req.tenant.slug },
    });

    await req.db.query(
      `INSERT INTO payment_transactions (booking_id, amount, gst_amount, payment_method, gateway_reference_token, status, tenant_id)
       VALUES ($1,$2,$3,'razorpay',$4,'initiated',$5)`,
      [booking_id, amount, bk.rows[0].tax_amount || 0, order.id, req.tenant.id]
    );

    res.json({ order_id: order.id, key_id: razorpayKeys(req).key_id, amount: order.amount });
  } catch (err) {
    console.error('[payments/create-order]', err.message);
    res.status(500).json({ error: err.message });
  }
});

/* POST /api/payments/verify  { booking_id, razorpay_order_id, razorpay_payment_id, razorpay_signature } */
router.post('/verify', requireAuth, async (req, res) => {
  const { booking_id, razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body || {};
  if (!booking_id || !razorpay_order_id || !razorpay_payment_id || !razorpay_signature)
    return res.status(400).json({ error: 'booking_id, razorpay_order_id, razorpay_payment_id and razorpay_signature are required' });

  const { key_secret: secret } = razorpayKeys(req);
  if (!secret) return res.status(503).json({ error: 'Razorpay is not configured for this resort' });

  const expectedSig = crypto
    .createHmac('sha256', secret)
    .update(`${razorpay_order_id}|${razorpay_payment_id}`)
    .digest('hex');

  if (expectedSig !== razorpay_signature)
    return res.status(400).json({ error: 'Payment signature verification failed' });

  try {
    // Update transaction status
    await req.db.query(
      `UPDATE payment_transactions
          SET status = 'captured', gateway_reference_token = $1
        WHERE booking_id = $2 AND gateway_reference_token = $3 AND tenant_id = $4`,
      [razorpay_payment_id, booking_id, razorpay_order_id, req.tenant.id]
    );
    // Update booking payment status
    await req.db.query(
      `UPDATE bookings SET payment_status = 'paid', advance_paid = total_amount, pending_amount = 0
        WHERE id = $1 AND tenant_id = $2`,
      [booking_id, req.tenant.id]
    );
    res.json({ ok: true, payment_id: razorpay_payment_id });
  } catch (err) {
    console.error('[payments/verify]', err.message);
    res.status(500).json({ error: err.message });
  }
});

/* POST /api/payments/refund  { booking_id, payment_id, amount } */
router.post('/refund', requireAuth, async (req, res) => {
  const { booking_id, payment_id, amount } = req.body || {};
  if (!booking_id || !payment_id || !amount)
    return res.status(400).json({ error: 'booking_id, payment_id and amount are required' });

  const rz = getRazorpay(req);
  if (!rz) return res.status(503).json({ error: 'Razorpay is not configured for this resort' });

  try {
    // Never refund a booking that isn't ours.
    const own = await req.db.query(
      'SELECT 1 FROM bookings WHERE id=$1 AND tenant_id=$2', [booking_id, req.tenant.id]
    );
    if (!own.rows[0]) return res.status(404).json({ error: 'Booking not found' });

    const refund = await rz.payments.refund(payment_id, { amount: Math.round(Number(amount) * 100) });

    await req.db.query(
      `INSERT INTO payment_transactions (booking_id, amount, gst_amount, payment_method, gateway_reference_token, status, tenant_id)
       VALUES ($1,$2,0,'razorpay',$3,'refunded',$4)`,
      [booking_id, amount, refund.id, req.tenant.id]
    );

    res.json({ ok: true, refund_id: refund.id });
  } catch (err) {
    console.error('[payments/refund]', err.message);
    res.status(500).json({ error: err.message });
  }
});

/* GET /api/payments/transactions?booking_id= */
router.get('/transactions', requireAuth, async (req, res) => {
  const { booking_id } = req.query;
  try {
    const where = booking_id ? 'WHERE pt.tenant_id = $1 AND pt.booking_id = $2' : 'WHERE pt.tenant_id = $1';
    const params = booking_id ? [req.tenant.id, booking_id] : [req.tenant.id];
    const { rows } = await req.db.query(
      `SELECT pt.id, pt.booking_id, b.reference, g.full_name AS guest_name,
              rt.name AS room, pt.amount, pt.gst_amount, pt.payment_method,
              pt.gateway_reference_token, pt.status, pt.created_at
         FROM payment_transactions pt
         JOIN bookings b   ON b.id = pt.booking_id
         JOIN guests g     ON g.id = b.guest_id
         JOIN room_types rt ON rt.id = b.room_type_id
        ${where}
        ORDER BY pt.created_at DESC LIMIT 200`,
      params
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
