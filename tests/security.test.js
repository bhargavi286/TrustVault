process.env.LOGIN_RATE_MAX = '1000'; // so tests do not hit the login rate limit
const request = require('supertest');
const jwt = require('jsonwebtoken');
const fs = require('fs');
const path = require('path');
const app = require('../src/app');
const pool = require('../src/db');
const storage = require('../src/services/storage');

jest.setTimeout(60000);

const SECRET_TEXT = `top-secret-${Date.now()}`;
const MISSING_ID = '00000000-0000-4000-8000-000000000000';
let t = {}; // tokens
let ids = {}; // user ids
let docId;
let storageKey;

async function login(email, password) {
  const res = await request(app).post('/api/auth/login').send({ email, password });
  expect(res.status).toBe(200);
  return res.body.token;
}
const auth = (token) => ({ Authorization: `Bearer ${token}` });
const download = (token, id = docId) => request(app).get(`/api/documents/${id}/download`).set(auth(token));
const meId = async (token) => (await request(app).get('/api/auth/me').set(auth(token))).body.id;
const binary = (res, cb) => {
  const chunks = [];
  res.on('data', (c) => chunks.push(c));
  res.on('end', () => cb(null, Buffer.concat(chunks)));
};

beforeAll(async () => {
  t.admin = await login('admin@trustvault.test', 'Admin-Demo-2026!');
  t.alice = await login('alice@trustvault.test', 'Alice-Demo-2026!');
  t.bob = await login('bob@trustvault.test', 'Bob-Demo-2026!');
  t.carol = await login('carol@trustvault.test', 'Carol-Demo-2026!');
  ids.alice = await meId(t.alice);
  ids.bob = await meId(t.bob);
  ids.carol = await meId(t.carol);

  const up = await request(app)
    .post('/api/documents')
    .set(auth(t.alice))
    .field('category', 'tests')
    .attach('file', Buffer.from(SECRET_TEXT), { filename: 'secret.txt', contentType: 'text/plain' });
  expect(up.status).toBe(201);
  docId = up.body.id;
  const row = await pool.query('SELECT storage_key FROM documents WHERE id = $1', [docId]);
  storageKey = row.rows[0].storage_key;
});

afterAll(async () => {
  await pool.query('DELETE FROM grants WHERE document_id = $1', [docId]);
  await pool.query('DELETE FROM documents WHERE id = $1', [docId]);
  await storage.remove(storageKey);
  await pool.end();
});

describe('authentication', () => {
  test('no token: 401 on download and list', async () => {
    expect((await request(app).get(`/api/documents/${docId}/download`)).status).toBe(401);
    expect((await request(app).get('/api/documents')).status).toBe(401);
  });

  test('token signed with the wrong secret: 401', async () => {
    const forged = jwt.sign({ sub: ids.alice, tv: 0 }, 'wrong-secret-wrong-secret-wrong-secret-xx');
    expect((await download(forged)).status).toBe(401);
  });

  test('unsigned token (alg none): 401', async () => {
    const forged = jwt.sign({ sub: ids.alice, tv: 0 }, '', { algorithm: 'none' });
    expect((await download(forged)).status).toBe(401);
  });

  test('wrong password: 401 and the refusal is in the audit log', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'alice@trustvault.test', password: 'wrong-password' });
    expect(res.status).toBe(401);
    const log = await pool.query(
      `SELECT 1 FROM audit_log WHERE action = 'auth.login' AND outcome = 'denied' AND actor_id = $1 AND ts > now() - interval '1 minute'`,
      [ids.alice]
    );
    expect(log.rowCount).toBeGreaterThan(0);
  });

  test('logout-all kills tokens issued before it', async () => {
    const old = await login('dave@trustvault.test', 'Dave-Demo-2026!');
    expect((await request(app).get('/api/auth/me').set(auth(old))).status).toBe(200);
    await request(app).post('/api/auth/logout-all').set(auth(old));
    expect((await request(app).get('/api/auth/me').set(auth(old))).status).toBe(401);
  });
});

describe('one user cannot reach another user\'s document', () => {
    test('owner can download her own document', async () => {
    const res = await download(t.alice).buffer(true).parse(binary);
    expect(res.status).toBe(200);
    expect(res.body.toString()).toBe(SECRET_TEXT);
  });

  test('another owner (no grant) gets 404 on download', async () => {
    expect((await download(t.bob)).status).toBe(404);
  });

  test('a refused request looks identical to a document that does not exist', async () => {
    const refused = await download(t.bob);
    const missing = await download(t.bob, MISSING_ID);
    expect(refused.status).toBe(missing.status);
    expect(refused.body).toEqual(missing.body);
  });

  test('viewer with no grant gets 404', async () => {
    expect((await download(t.carol)).status).toBe(404);
  });

  test('document does not appear in list or search of a user without a grant', async () => {
    const list = await request(app).get('/api/documents').set(auth(t.bob));
    expect(list.status).toBe(200);
    expect(list.body.find((d) => d.id === docId)).toBeUndefined();
    const search = await request(app).get('/api/documents?q=secret').set(auth(t.bob));
    expect(search.body.find((d) => d.id === docId)).toBeUndefined();
  });

  test('admin cannot read document content, list is empty', async () => {
    expect((await download(t.admin)).status).toBe(404);
    const list = await request(app).get('/api/documents').set(auth(t.admin));
    expect(list.body).toEqual([]);
  });

  test('non-owner cannot see or change who has access', async () => {
    expect((await request(app).get(`/api/documents/${docId}/grants`).set(auth(t.bob))).status).toBe(404);
    const res = await request(app)
      .post(`/api/documents/${docId}/grants`)
      .set(auth(t.bob))
      .send({ email: 'bob@trustvault.test', permission: 'read' });
    expect(res.status).toBe(404);
    expect((await download(t.bob)).status).toBe(404); // still no access
  });

  test('viewer role cannot upload', async () => {
    const res = await request(app)
      .post('/api/documents')
      .set(auth(t.carol))
      .attach('file', Buffer.from('x'), { filename: 'x.txt', contentType: 'text/plain' });
    expect(res.status).toBe(403);
  });

  test('malformed ids and injection strings give 404, never 500', async () => {
    for (const bad of ['abc', "1'%20OR%20'1'='1", '..%2F..%2Fetc%2Fpasswd']) {
      expect((await request(app).get(`/api/documents/${bad}/download`).set(auth(t.alice))).status).toBe(404);
    }
    const res = await request(app).get("/api/documents?q=%27%20OR%201=1--").set(auth(t.bob));
    expect(res.status).toBe(200);
    expect(res.body.find((d) => d.id === docId)).toBeUndefined();
  });
});

describe('granting and taking access away', () => {
  test('read grant allows download but not sharing; revoke works immediately with the same token', async () => {
    const grant = await request(app)
      .post(`/api/documents/${docId}/grants`)
      .set(auth(t.alice))
      .send({ email: 'carol@trustvault.test', permission: 'read' });
    expect(grant.status).toBe(201);

    expect((await download(t.carol)).status).toBe(200);

    const reshare = await request(app)
      .post(`/api/documents/${docId}/grants`)
      .set(auth(t.carol))
      .send({ email: 'bob@trustvault.test', permission: 'read' });
    expect(reshare.status).toBe(404);

    const revoke = await request(app).delete(`/api/documents/${docId}/grants/${ids.carol}`).set(auth(t.alice));
    expect(revoke.status).toBe(200);

    expect((await download(t.carol)).status).toBe(404); // same token, access gone
    const list = await request(app).get('/api/documents').set(auth(t.carol));
    expect(list.body.find((d) => d.id === docId)).toBeUndefined();
  });

  test('cannot grant to admin or to yourself', async () => {
    for (const email of ['admin@trustvault.test', 'alice@trustvault.test']) {
      const res = await request(app)
        .post(`/api/documents/${docId}/grants`)
        .set(auth(t.alice))
        .send({ email, permission: 'read' });
      expect(res.status).toBe(400);
    }
  });
});

describe('uploads', () => {
  test('file whose bytes do not match its extension is rejected', async () => {
    const res = await request(app)
      .post('/api/documents')
      .set(auth(t.alice))
      .attach('file', Buffer.from('this is not a pdf'), { filename: 'fake.pdf', contentType: 'application/pdf' });
    expect(res.status).toBe(400);
  });

  test('executable extension is rejected', async () => {
    const res = await request(app)
      .post('/api/documents')
      .set(auth(t.alice))
      .attach('file', Buffer.from('MZ...'), { filename: 'virus.exe', contentType: 'application/octet-stream' });
    expect(res.status).toBe(400);
  });

  test('path in the file name is stripped', async () => {
    const res = await request(app)
      .post('/api/documents')
      .set(auth(t.alice))
      .attach('file', Buffer.from('hello'), { filename: '../../evil.txt', contentType: 'text/plain' });
    expect(res.status).toBe(201);
    expect(res.body.name).not.toMatch(/[\\/]/);
    // clean up this extra document
    const row = await pool.query('SELECT storage_key FROM documents WHERE id = $1', [res.body.id]);
    await pool.query('DELETE FROM documents WHERE id = $1', [res.body.id]);
    await storage.remove(row.rows[0].storage_key);
  });

  test('file on disk does not contain the plain text', () => {
    const raw = fs.readFileSync(path.join(__dirname, '..', 'storage', storageKey));
    expect(raw.includes(Buffer.from(SECRET_TEXT))).toBe(false);
  });
});

describe('audit trail', () => {
  test('a refused download is recorded with who, what and the outcome', async () => {
    await download(t.bob);
    const log = await pool.query(
      `SELECT 1 FROM audit_log WHERE action = 'document.download' AND outcome = 'denied'
       AND document_id = $1 AND actor_id = $2`,
      [docId, ids.bob]
    );
    expect(log.rowCount).toBeGreaterThan(0);
  });

  test('grant and revoke are recorded', async () => {
    const log = await pool.query(
      `SELECT action FROM audit_log WHERE document_id = $1 AND action IN ('grant.create', 'grant.revoke')`,
      [docId]
    );
    const actions = log.rows.map((r) => r.action);
    expect(actions).toContain('grant.create');
    expect(actions).toContain('grant.revoke');
  });

  test('audit records cannot be changed or deleted, even by the app database user', async () => {
    await expect(
      pool.query("UPDATE audit_log SET action = 'x' WHERE id = (SELECT max(id) FROM audit_log)")
    ).rejects.toThrow(/append-only/);
    await expect(pool.query('DELETE FROM audit_log')).rejects.toThrow(/append-only/);
  });
});