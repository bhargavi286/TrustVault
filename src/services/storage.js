require('../config');
const crypto = require('crypto');
const pool = require('../db');

const hex = process.env.STORAGE_KEY || '';
if (!/^[0-9a-f]{64}$/i.test(hex)) {
  throw new Error('STORAGE_KEY must be 64 hex characters');
}
const key = Buffer.from(hex, 'hex');
const KEY_FORMAT = /^[0-9a-f]{48}$/;

// Encrypts the file and stores the bytes in the database under a random key.
async function save(plaintext) {
  const storageKey = crypto.randomBytes(24).toString('hex');
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(storageKey)); // ties the bytes to this record
  const enc = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  await pool.query('INSERT INTO file_blobs (storage_key, data) VALUES ($1, $2)', [
    storageKey,
    Buffer.concat([iv, tag, enc]),
  ]);
  return storageKey;
}

async function read(storageKey) {
  if (!KEY_FORMAT.test(storageKey)) throw new Error('bad storage key');
  const { rows } = await pool.query('SELECT data FROM file_blobs WHERE storage_key = $1', [storageKey]);
  if (!rows[0]) throw new Error('stored file is missing');
  const blob = rows[0].data;
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, blob.subarray(0, 12));
  decipher.setAAD(Buffer.from(storageKey));
  decipher.setAuthTag(blob.subarray(12, 28));
  return Buffer.concat([decipher.update(blob.subarray(28)), decipher.final()]);
}

async function remove(storageKey) {
  if (!KEY_FORMAT.test(storageKey)) return;
  await pool.query('DELETE FROM file_blobs WHERE storage_key = $1', [storageKey]);
}

module.exports = { save, read, remove };