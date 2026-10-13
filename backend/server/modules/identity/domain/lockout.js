/**
 * lockout.js — pure login-lockout policy. Returns Result objects, never throws.
 *
 * State is { failed: number, lockedUntil: Date|null }. Escalating lock:
 * after MAX_FAILED consecutive failures the account locks for
 * BASE_LOCK_MS * 2^(strikes) (capped), where strikes counts how many full
 * MAX_FAILED rounds were exhausted.
 */
const MAX_FAILED = 5;
const BASE_LOCK_MS = 5 * 60 * 1000;
const MAX_LOCK_MS = 60 * 60 * 1000;

function checkLocked(state, now = new Date()) {
  const until = state?.lockedUntil ? new Date(state.lockedUntil) : null;
  if (until && until > now) {
    return { ok: false, error: { code: 'ACCOUNT_LOCKED', message: 'Too many failed attempts — try again later', retryAfterMs: until - now } };
  }
  return { ok: true, value: true };
}

/** Next state after a failed attempt. */
function recordFailure(state, now = new Date()) {
  const failed = (state?.failed || 0) + 1;
  if (failed % MAX_FAILED !== 0) return { failed, lockedUntil: null };
  const strikes = failed / MAX_FAILED - 1;
  const ms = Math.min(BASE_LOCK_MS * 2 ** strikes, MAX_LOCK_MS);
  return { failed, lockedUntil: new Date(now.getTime() + ms) };
}

/** Next state after a successful login. */
function recordSuccess() {
  return { failed: 0, lockedUntil: null };
}

module.exports = { checkLocked, recordFailure, recordSuccess, MAX_FAILED, BASE_LOCK_MS, MAX_LOCK_MS };
