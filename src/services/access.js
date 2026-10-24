const pool = require('../db');
const { logEvent } = require('./audit');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ACTIONS = ['read', 'download', 'edit', 'delete', 'share'];

// THE ONLY PLACE where "can this user do this to this document" is decided.
// Default is deny. Every route that touches a document must go through authorize().
async function decide(user, doc, action) {
  if (!doc || doc.deleted_at) return false;
  if (doc.owner_id === user.id) return true;               // owner: everything
  if (action === 'delete' || action === 'share') return false; // owner only
  if (user.role === 'admin') return false;                 // admin never reads content

  const { rows } = await pool.query(
    'SELECT permission FROM grants WHERE document_id = $1 AND user_id = $2 AND revoked_at IS NULL',
    [doc.id, user.id]
  );
  const permission = rows[0] && rows[0].permission;
  if (!permission) return false;
  if (action === 'read' || action === 'download') return true; // 'read' or 'edit' grant
  if (action === 'edit') return permission === 'edit';
  return false;
}

// Returns the document if allowed, otherwise null. Refusals are always recorded.
// By default an allowed decision is recorded here too. Pass { deferAllowed: true } when the
// action can still fail after the decision (for example reading the file); the caller must
// then call recordAllowed() once the action has really succeeded.
// If an audit write fails, the request fails too (no access without a record).
async function authorize(req, docId, action, options = {}) {
  if (!ACTIONS.includes(action)) throw new Error('unknown action: ' + action);

  let doc = null;
  if (typeof docId === 'string' && UUID.test(docId)) {
    const { rows } = await pool.query('SELECT * FROM documents WHERE id = $1', [docId]);
    doc = rows[0] || null;
  }
  const allowed = doc ? await decide(req.user, doc, action) : false;

  if (!allowed || options.deferAllowed !== true) {
    await logEvent({
      actorId: req.user.id,
      action: `document.${action}`,
      outcome: allowed ? 'allowed' : 'denied',
      documentId: doc ? doc.id : null,
      ip: req.ip,
      details: allowed
        ? {}
        : { reason: doc ? 'no_permission' : 'not_found_or_invalid_id', requested_id: String(docId).slice(0, 64) },
    });
  }

  return allowed ? doc : null;
}

async function recordAllowed(req, doc, action, details = {}) {
  await logEvent({
    actorId: req.user.id,
    action: `document.${action}`,
    outcome: 'allowed',
    documentId: doc.id,
    ip: req.ip,
    details,
  });
}

module.exports = { authorize, recordAllowed };