const express = require('express');
const multer = require('multer');
const path = require('path');
const crypto = require('crypto');
const pool = require('../db');
const { authenticate, requireRole } = require('../middleware/auth');
const { authorize } = require('./../services/access');
const { logEvent } = require('../services/audit');
const storage = require('../services/storage');

const router = express.Router();
const MAX_BYTES = 5 * 1024 * 1024;

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

router.get('/:id/download', authenticate, async (req, res, next) => {
  try {
    const doc = await authorize(req, req.params.id, 'download');
    if (!doc) return res.status(404).json({ error: 'Not found' });

    const data = await storage.read(doc.storage_key);
    res.attachment(doc.name);
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Cache-Control', 'no-store');
    res.send(data);
  } catch (err) {
    next(err);
  }
});

module.exports = router;