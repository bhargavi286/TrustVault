const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const pool = require('../db');
const { jwtSecret, jwtExpiresIn } = require('../config');
const { logEvent } = require('../services/audit');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

// Used when the email does not exist, so response time does not reveal which emails are real
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 12);

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: Number(process.env.LOGIN_RATE_MAX) || 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many login attempts. Try again later.' },
});

router.post('/login', loginLimiter, async (req, res, next) => {
  try {
    const { email, password } = req.body || {};
    if (
      typeof email !== 'string' || typeof password !== 'string' ||
      email.length > 254 || password.length === 0 || password.length > 72
    ) {
      return res.status(400).json({ error: 'email and password are required' });
    }
    const cleanEmail = email.trim().toLowerCase();

    const { rows } = await pool.query(
      'SELECT id, password_hash, role, token_version, is_active FROM users WHERE email = $1',
      [cleanEmail]
    );
    const user = rows[0];
    const passwordOk = await bcrypt.compare(password, user ? user.password_hash : DUMMY_HASH);

    if (!user || !passwordOk || !user.is_active) {
      await logEvent({
        actorId: user ? user.id : null,
        action: 'auth.login',
        outcome: 'denied',
        ip: req.ip,
        details: {
          attempted_email: cleanEmail,
          reason: !user ? 'unknown_email' : !passwordOk ? 'bad_password' : 'inactive',
        },
      });
      // Same message for every failure, so attackers learn nothing
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const token = jwt.sign({ sub: user.id, tv: user.token_version }, jwtSecret, {
      algorithm: 'HS256',
      expiresIn: jwtExpiresIn,
    });
    await logEvent({ actorId: user.id, action: 'auth.login', outcome: 'allowed', ip: req.ip });
    res.json({ token, role: user.role });
  } catch (err) {
    next(err);
  }
});

router.get('/me', authenticate, (req, res) => {
  res.json(req.user);
});

// Invalidates every token this user has ever been issued
router.post('/logout-all', authenticate, async (req, res, next) => {
  try {
    await pool.query('UPDATE users SET token_version = token_version + 1 WHERE id = $1', [req.user.id]);
    await logEvent({ actorId: req.user.id, action: 'auth.logout_all', outcome: 'allowed', ip: req.ip });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;