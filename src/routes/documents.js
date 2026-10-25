const express = require('express');
const multer = require('multer');
const path = require('path');
const crypto = require('crypto');
const pool = require('../db');
const { authenticate, requireRole } = require('../middleware/auth');
const { authorize, recordAllowed } = require('../services/access');
const { logEvent } = require('../services/audit');
const storage = require('../services/storage');

const router = express.Router();
const MAX_BYTES = 5 * 1024 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PERMISSIONS = ['read', 'edit'];

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_BYTES, files: 1, fields: 5 },
});

const isJpeg = (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;

// Allowed types. Checked by extension AND by the real bytes of the file.
const TYPES = {
  '.pdf': { mime: 'application/pdf', ok: (b) => b.subarray(0, 5).toString('latin1') === '%PDF-' },
  '.png': { mime: 'image/png', ok: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  '.jpg': { mime: 'image/jpeg', ok: isJpeg },
  '.jpeg': { mime: 'image/jpeg', ok: isJpeg },
  '.txt': { mime: 'text/plain', ok: (b) => !b.includes(0) },
};

function cleanName(original) {
  const base = path.basename(String(original).replace(/\\/g, '/'));
  const safe = base.replace(/[^\w.\- ()]/g, '_').slice(0, 200);
  return safe || 'file';
}

const likeEscape = (s) => s.replace(/[\\%_]/g, '\\$&');

function validDate(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(s + 'T00:00:00Z');
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

async function refuseUpload(req, res, status, reason) {
  await logEvent({
    actorId: req.user.id,
    action: 'document.upload',
    outcome: 'denied',
    ip: req.ip,
    details: { reason },
  });
  return res.status(status).json({ error: 'Upload rejected: ' + reason });
}

/* ---------- Upload (owner role only) ---------- */
// Order matters: log in, check role, only then read the upload body.
router.post(
  '/',
  authenticate,
  requireRole('owner'),
  (req, res, next) => {
    upload.single('file')(req, res, (err) => {
      if (!err) return next();
      const tooBig = err.code === 'LIMIT_FILE_SIZE';
      refuseUpload(req, res, tooBig ? 413 : 400, tooBig ? 'file_too_large' : 'bad_upload').catch(next);
    });
  },
  async (req, res, next) => {
    let storageKey = null;
    try {
      const file = req.file;
      if (!file) return refuseUpload(req, res, 400, 'no_file');

      const ext = path.extname(file.originalname).toLowerCase();
      const type = TYPES[ext];
      if (!type || file.size === 0 || !type.ok(file.buffer)) {
        return refuseUpload(req, res, 400, 'file_type_not_allowed');
      }

      let category = typeof req.body.category === 'string' ? req.body.category.trim() : '';
      if (!category) category = 'general';
      if (!/^[\w &-]{1,50}$/.test(category)) return refuseUpload(req, res, 400, 'bad_category');

      const name = cleanName(file.originalname);
      const sha256 = crypto.createHash('sha256').update(file.buffer).digest('hex');
      storageKey = await storage.save(file.buffer);

      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const { rows } = await client.query(
          `INSERT INTO documents (owner_id, name, category, mime_type, size_bytes, sha256, storage_key)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           RETURNING id, name, category, size_bytes, created_at`,
          [req.user.id, name, category, type.mime, file.size, sha256, storageKey]
        );
        await logEvent(
          {
            actorId: req.user.id,
            action: 'document.upload',
            outcome: 'allowed',
            documentId: rows[0].id,
            ip: req.ip,
            details: { name, size_bytes: file.size, sha256 },
          },
          client
        );
        await client.query('COMMIT');
        res.status(201).json(rows[0]);
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    } catch (err) {
      if (storageKey) await storage.remove(storageKey).catch(() => {});
      next(err);
    }
  }
);

/* ---------- List and search ---------- */
// The permission filter is inside the SQL itself:
// a user only ever gets documents they own or hold an active grant for.
router.get('/', authenticate, async (req, res, next) => {
  try {
    if (req.user.role === 'admin') return res.json([]); // admin never sees document content

    const filters = { q: req.query.q, owner: req.query.owner, category: req.query.category, from: req.query.from, to: req.query.to };
    for (const [k, v] of Object.entries(filters)) {
      if (v !== undefined && (typeof v !== 'string' || v.length > 100)) {
        return res.status(400).json({ error: `Bad ${k}` });
      }
    }

    const params = [req.user.id];
    const where = [];
    if (filters.q) {
      params.push('%' + likeEscape(filters.q) + '%');
      where.push(`d.name ILIKE $${params.length}`);
    }
    if (filters.owner) {
      params.push('%' + likeEscape(filters.owner) + '%');
      where.push(`u.email ILIKE $${params.length}`);
    }
    if (filters.category) {
      params.push(filters.category);
      where.push(`d.category = $${params.length}`);
    }
    if (filters.from) {
      if (!validDate(filters.from)) return res.status(400).json({ error: 'Bad from date (use YYYY-MM-DD)' });
      params.push(filters.from);
      where.push(`d.created_at >= $${params.length}::date`);
    }
    if (filters.to) {
      if (!validDate(filters.to)) return res.status(400).json({ error: 'Bad to date (use YYYY-MM-DD)' });
      params.push(filters.to);
      where.push(`d.created_at < ($${params.length}::date + 1)`);
    }

    const { rows } = await pool.query(
      `SELECT d.id, d.name, d.category, d.size_bytes, d.created_at, u.email AS owner_email,
              CASE WHEN d.owner_id = $1 THEN 'owner' ELSE g.permission END AS my_permission
       FROM documents d
       JOIN users u ON u.id = d.owner_id
       LEFT JOIN grants g ON g.document_id = d.id AND g.user_id = $1 AND g.revoked_at IS NULL
       WHERE d.deleted_at IS NULL AND (d.owner_id = $1 OR g.id IS NOT NULL)
       ${where.length ? 'AND ' + where.join(' AND ') : ''}
       ORDER BY d.created_at DESC
       LIMIT 50`,
      params
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

/* ---------- Download ---------- */
router.get('/:id/download', authenticate, async (req, res, next) => {
  try {
    // The "allowed" record is deferred until the file has really been read
    const doc = await authorize(req, req.params.id, 'download', { deferAllowed: true });
    if (!doc) return res.status(404).json({ error: 'Not found' });

    let data;
    try {
      data = await storage.read(doc.storage_key);
    } catch (err) {
      // Permission was fine but nothing was delivered: record that, not "allowed"
      await logEvent({
        actorId: req.user.id,
        action: 'document.download',
        outcome: 'denied',
        documentId: doc.id,
        ip: req.ip,
        details: { reason: 'storage_read_failed' },
      }).catch(() => {});
      throw err;
    }
    await recordAllowed(req, doc, 'download'); // written before any byte is sent

    res.attachment(doc.name);
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Cache-Control', 'no-store');
    res.send(data);
  } catch (err) {
    next(err);
  }
});

/* ---------- Sharing (owner only) ---------- */
// Who has access to this document
router.get('/:id/grants', authenticate, async (req, res, next) => {
  try {
    const doc = await authorize(req, req.params.id, 'share');
    if (!doc) return res.status(404).json({ error: 'Not found' });
    const { rows } = await pool.query(
      `SELECT g.user_id, u.email, g.permission, g.granted_at
       FROM grants g JOIN users u ON u.id = g.user_id
       WHERE g.document_id = $1 AND g.revoked_at IS NULL
       ORDER BY g.granted_at`,
      [doc.id]
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

// Grant (or change) access
router.post('/:id/grants', authenticate, async (req, res, next) => {
  try {
    const doc = await authorize(req, req.params.id, 'share');
    if (!doc) return res.status(404).json({ error: 'Not found' });

    const { email, permission } = req.body || {};
    if (typeof email !== 'string' || !PERMISSIONS.includes(permission)) {
      return res.status(400).json({ error: 'email and permission (read or edit) are required' });
    }
    const found = await pool.query('SELECT id, role, is_active FROM users WHERE email = $1', [email.trim().toLowerCase()]);
    const target = found.rows[0];
    if (!target || !target.is_active || target.role === 'admin' || target.id === req.user.id) {
      return res.status(400).json({ error: 'Cannot grant access to that user' });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const prev = await client.query(
        `UPDATE grants SET revoked_at = now()
         WHERE document_id = $1 AND user_id = $2 AND revoked_at IS NULL
         RETURNING permission`,
        [doc.id, target.id]
      );
      await client.query(
        'INSERT INTO grants (document_id, user_id, permission, granted_by) VALUES ($1, $2, $3, $4)',
        [doc.id, target.id, permission, req.user.id]
      );
      await logEvent(
        {
          actorId: req.user.id,
          action: prev.rowCount ? 'grant.update' : 'grant.create',
          outcome: 'allowed',
          documentId: doc.id,
          targetUserId: target.id,
          ip: req.ip,
          details: { permission, previous: prev.rowCount ? prev.rows[0].permission : null },
        },
        client
      );
      await client.query('COMMIT');
      res.status(201).json({ ok: true, user_id: target.id, permission });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    next(err);
  }
});

// Take access away. Works on the very next request from that user.
router.delete('/:id/grants/:userId', authenticate, async (req, res, next) => {
  try {
    const doc = await authorize(req, req.params.id, 'share');
    if (!doc) return res.status(404).json({ error: 'Not found' });
    if (!UUID.test(req.params.userId)) return res.status(400).json({ error: 'Bad user id' });

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const done = await client.query(
        `UPDATE grants SET revoked_at = now()
         WHERE document_id = $1 AND user_id = $2 AND revoked_at IS NULL
         RETURNING permission`,
        [doc.id, req.params.userId]
      );
      if (!done.rowCount) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'No active grant for that user' });
      }
      await logEvent(
        {
          actorId: req.user.id,
          action: 'grant.revoke',
          outcome: 'allowed',
          documentId: doc.id,
          targetUserId: req.params.userId,
          ip: req.ip,
          details: { previous: done.rows[0].permission },
        },
        client
      );
      await client.query('COMMIT');
      res.json({ ok: true });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    next(err);
  }
});
/* ---------- Edit and delete ---------- */
// Rename or re-categorise. Owner, or someone holding an 'edit' grant.
router.patch('/:id', authenticate, async (req, res, next) => {
  try {
    const doc = await authorize(req, req.params.id, 'edit', { deferAllowed: true });
    if (!doc) return res.status(404).json({ error: 'Not found' });

    const body = req.body || {};
    const changes = {};
    if (body.name !== undefined) {
      if (typeof body.name !== 'string' || !body.name.trim()) return res.status(400).json({ error: 'Bad name' });
      const name = cleanName(body.name.trim());
      if (path.extname(name).toLowerCase() !== path.extname(doc.name).toLowerCase()) {
        return res.status(400).json({ error: 'The file extension cannot be changed' });
      }
      changes.name = name;
    }
    if (body.category !== undefined) {
      if (typeof body.category !== 'string' || !/^[\w &-]{1,50}$/.test(body.category.trim())) {
        return res.status(400).json({ error: 'Bad category' });
      }
      changes.category = body.category.trim();
    }
    if (!Object.keys(changes).length) return res.status(400).json({ error: 'Nothing to change' });

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query(
        `UPDATE documents
         SET name = COALESCE($2, name), category = COALESCE($3, category), updated_at = now()
         WHERE id = $1 AND deleted_at IS NULL
         RETURNING id, name, category, size_bytes, updated_at`,
        [doc.id, changes.name || null, changes.category || null]
      );
      if (!rows[0]) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Not found' });
      }
      await logEvent(
        {
          actorId: req.user.id,
          action: 'document.edit',
          outcome: 'allowed',
          documentId: doc.id,
          ip: req.ip,
          details: { before: { name: doc.name, category: doc.category }, after: changes },
        },
        client
      );
      await client.query('COMMIT');
      res.json(rows[0]);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    next(err);
  }
});

// Delete. Owner only. The document is hidden everywhere; the encrypted bytes are kept
// so it can be recovered, and the audit trail keeps the record.
router.delete('/:id', authenticate, async (req, res, next) => {
  try {
    const doc = await authorize(req, req.params.id, 'delete', { deferAllowed: true });
    if (!doc) return res.status(404).json({ error: 'Not found' });

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { rowCount } = await client.query(
        'UPDATE documents SET deleted_at = now(), updated_at = now() WHERE id = $1 AND deleted_at IS NULL',
        [doc.id]
      );
      if (!rowCount) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Not found' });
      }
      await logEvent(
        {
          actorId: req.user.id,
          action: 'document.delete',
          outcome: 'allowed',
          documentId: doc.id,
          ip: req.ip,
          details: { name: doc.name },
        },
        client
      );
      await client.query('COMMIT');
      res.json({ ok: true });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    next(err);
  }
});

module.exports = router;