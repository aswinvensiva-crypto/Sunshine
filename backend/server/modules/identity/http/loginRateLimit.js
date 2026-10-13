/**
 * loginRateLimit — per-IP throttle in front of every credential endpoint.
 * This is the coarse outer wall; per-account lockout (domain/lockout.js)
 * is the inner one. Disabled when NODE_ENV=test so suites can log in freely.
 */
const rateLimit = require('express-rate-limit');

function makeLoginLimiter({ windowMs = 15 * 60 * 1000, max = 30 } = {}) {
  if (process.env.NODE_ENV === 'test') return (req, res, next) => next();
  return rateLimit({
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many login attempts — please wait a few minutes', code: 'RATE_LIMITED' },
  });
}

module.exports = { makeLoginLimiter };
