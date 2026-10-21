const jwt = require('jsonwebtoken');
const pool = require('../db');
const { jwtSecret } = require('../config');
const { logEvent } = require('../services/audit');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function reject(req, res, reason, actorId = null, audit = true) {
  if (audit) {
    await logEvent({
      actorId,
      action: 'auth.token_rejected',
      outcome: 'denied',
      ip: req.ip,
      details: { reason, path: req.path },
    });
  }
  return res.status(401).json({ error: 'Authentication required' });
}

// Runs on every protected request. The database is checked every time,
// so revoking a user (token_version bump or is_active=false) works immediately.
async function authenticate(req, res, next) {
  try {
    const [scheme, token] = (req.headers.authorization || '').split(' ');
    if (scheme !== 'Bearer' || !token) {
      return reject(req, res, 'missing_token', null, false);
    }

    let payload;
    try {
      payload = jwt.verify(token, jwtSecret, { algorithms: ['HS256'] });
    } catch (err) {
      return reject(req, res, 'invalid_or_expired_token');
    }
    if (typeof payload.sub !== 'string' || !UUID.test(payload.sub)) {
      return reject(req, res, 'bad_subject');
    }

    const { rows } = await pool.query(
      'SELECT id, email, role, token_version, is_active FROM users WHERE id = $1',
      [payload.sub]
    );
    const user = rows[0];
    if (!user || !user.is_active || user.token_version !== payload.tv) {
      return reject(req, res, 'revoked_or_inactive', user ? user.id : null);
    }

    req.user = { id: user.id, email: user.email, role: user.role };
    next();
  } catch (err) {
    next(err);
  }
}

function requireRole(...roles) {
  return async (req, res, next) => {
    try {
      if (!req.user || !roles.includes(req.user.role)) {
        await logEvent({
          actorId: req.user ? req.user.id : null,
          action: 'auth.role_denied',
          outcome: 'denied',
          ip: req.ip,
          details: { required: roles, path: req.path, method: req.method },
        });
        return res.status(403).json({ error: 'Forbidden' });
      }
      next();
    } catch (err) {
      next(err);
    }
  };
}

module.exports = { authenticate, requireRole };