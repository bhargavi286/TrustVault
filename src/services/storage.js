require('../config');
const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');

const dir = path.join(__dirname, '..', '..', 'storage');

const hex = process.env.STORAGE_KEY || '';
if (!/^[0-9a-f]{64}$/i.test(hex)) {
  throw new Error('STORAGE_KEY must be 64 hex characters');
}
const key = Buffer.from(hex, 'hex');
const KEY_FORMAT = /^[0-9a-f]{48}$/;

// Encrypts the file and stores it under a random name. Returns that name.
async function save(plaintext) {
  const storageKey = crypto.randomBytes(24).toString('hex');
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(storageKey)); // ties the bytes to this record
  const enc = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, storageKey), Buffer.concat([iv, tag, enc]), { flag: 'wx' });
  return storageKey;
}

async function read(storageKey) {
  if (!KEY_FORMAT.test(storageKey)) throw new Error('bad storage key');
  const blob = await fs.readFile(path.join(dir, storageKey));
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, blob.subarray(0, 12));
  decipher.setAAD(Buffer.from(storageKey));
  decipher.setAuthTag(blob.subarray(12, 28));
  return Buffer.concat([decipher.update(blob.subarray(28)), decipher.final()]);
}

async function remove(storageKey) {
  if (!KEY_FORMAT.test(storageKey)) return;
  await fs.rm(path.join(dir, storageKey), { force: true });
}

module.exports = { save, read, remove };