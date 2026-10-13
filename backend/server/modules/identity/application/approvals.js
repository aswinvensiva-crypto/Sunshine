/**
 * approvals.js (application) — create / decide approval requests.
 * Executors are registered per kind so the approver's click performs the
 * originally-requested action exactly once, inside one transaction.
 */
const { recordBookingRefund, issueGatewayRefund } = require('../../../services/refunds');

const EXECUTORS = {
  // payload: { booking_id, refund_amount, refund_method, reason, notes }
  async 'refund.booking'(ctx, a) {
    const p = a.payload;
    return recordBookingRefund(ctx.client, {
      tenantId: ctx.tenant.id, bookingId: p.booking_id, amount: p.refund_amount,
      method: p.refund_method, reason: p.reason, notes: p.notes, userId: a.requested_by,
    });
  },
  // payload: { booking_id, payment_id, amount }
  async 'refund.gateway'(ctx, a) {
    const p = a.payload;
    return issueGatewayRefund(ctx.client, ctx.tenant, { bookingId: p.booking_id, paymentId: p.payment_id, amount: p.amount });
  },
};

/** Persist a pending request. */
async function createApproval(db, tenant, user, { kind, amount, reason, payload }) {
  const { rows } = await db.query(
    `INSERT INTO approval_requests (tenant_id, kind, payload, amount, reason, requested_by, requested_by_type, requested_by_name)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id, kind, status, amount, created_at`,
    [tenant.id, kind, JSON.stringify(payload), amount ?? null, reason || null,
     user.id ?? user.employee_id ?? null, user.type === 'employee' ? 'employee' : 'user', user.username]
  );
  return rows[0];
}

/**
 * Decide a request. Idempotent: a request that is no longer pending returns
 * ALREADY_DECIDED, so a double click can never execute twice.
 */
async function decideApproval(db, tenant, decider, id, { approve, note }) {
  return db.tx(async (client) => {
    const r = await client.query(`SELECT * FROM approval_requests WHERE id=$1 AND tenant_id=$2 FOR UPDATE`, [id, tenant.id]);
    const a = r.rows[0];
    if (!a) return { ok: false, error: { code: 'NOT_FOUND', message: 'Approval request not found' } };
    if (a.status !== 'pending') return { ok: false, error: { code: 'ALREADY_DECIDED', message: `Request already ${a.status}` } };
    if (a.requested_by_type === 'user' && Number(a.requested_by) === Number(decider.id)) {
      return { ok: false, error: { code: 'SELF_APPROVAL', message: 'You cannot approve your own request' } };
    }

    if (!approve) {
      await client.query(
        `UPDATE approval_requests SET status='rejected', decided_by=$1, decided_at=now(), decision_note=$2 WHERE id=$3`,
        [decider.id, note || null, id]
      );
      return { ok: true, value: { id, status: 'rejected' } };
    }

    const exec = EXECUTORS[a.kind];
    if (!exec) return { ok: false, error: { code: 'UNKNOWN_APPROVAL_KIND', message: `No executor for ${a.kind}` } };
    // Savepoint: a failed execution must not leave half-applied changes.
    await client.query('SAVEPOINT exec');
    let res;
    try {
      res = await exec({ client, tenant }, a);
    } catch (err) {
      res = { ok: false, error: { code: 'EXECUTION_FAILED', message: err.message } };
    }
    if (!res.ok) {
      await client.query('ROLLBACK TO SAVEPOINT exec');
      await client.query(
        `UPDATE approval_requests SET status='failed', decided_by=$1, decided_at=now(), decision_note=$2, result=$3 WHERE id=$4`,
        [decider.id, note || null, JSON.stringify(res.error), id]
      );
      return { ok: false, error: res.error, persisted: true };
    }
    await client.query(
      `UPDATE approval_requests SET status='approved', decided_by=$1, decided_at=now(), decision_note=$2, result=$3 WHERE id=$4`,
      [decider.id, note || null, JSON.stringify(res.value), id]
    );
    return { ok: true, value: { id, status: 'approved', result: res.value } };
  });
}

function approvalPolicy(env = process.env) {
  return env.REFUND_APPROVAL_THRESHOLD ? { refundThreshold: Number(env.REFUND_APPROVAL_THRESHOLD) } : {};
}

module.exports = { createApproval, decideApproval, approvalPolicy, EXECUTORS };
