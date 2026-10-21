const pool = require('../db');

// Writes one audit record. Never put passwords, tokens or file contents in `details`.
// Pass `client` when inside a transaction so the audit row commits or rolls back with the action.
async function logEvent(
  { actorId = null, action, outcome, documentId = null, targetUserId = null, ip = null, details = {} },
  client = pool
) {
  await client.query(
    `INSERT INTO audit_log (actor_id, action, outcome, document_id, target_user_id, ip, details)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [actorId, action, outcome, documentId, targetUserId, ip, JSON.stringify(details)]
  );
}

module.exports = { logEvent };