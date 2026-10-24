# THREATS.md

Format: threat, what I did, status (closed / partly closed / knowingly accepted).

## T1. Someone edits or deletes audit records to hide an access
- Did: audit_log has database triggers that reject UPDATE, DELETE and TRUNCATE. Each row stores the hash of the previous row, computed by the database, so editing history breaks the chain.
- Proof: db/audit-test.js
- Status: partly closed.
- Known weakness: the database owner role can still drop the triggers or rewrite the table including hashes. Planned: run the app with a separate low-privilege database role that has INSERT and SELECT only on audit_log, and verify the chain with an admin check endpoint.

## T2. Secrets leak through the Git repository
- Did: .env, node_modules, uploads and storage are in .gitignore. Checked with git ls-files.
- Status: closed.

## T3. Dev dependency vulnerabilities (npm audit shows 19 moderate)
- Did: they are in jest (test tooling) only and not shipped to production. I did not run `npm audit fix --force` because it can break the toolchain.
- Status: knowingly accepted.
## T4. A user reaches a document that was not granted to them (IDOR, forgotten check, other roles)
- Did: every document route calls authorize() in src/services/access.js, which defaults to deny. Not-granted and not-existing both return the same 404, so ids cannot be probed. Admin has no content access. Grants are checked in the database on every request. List and search filter by grant inside the SQL.
- Proof: tests/security.test.js (cross-user download, list, search, grants, admin, viewer upload).
- Mutation check: I forced decide() to return true. 8 of 23 tests failed (another owner, viewer, admin, re-share by a non-owner, audit of refusals). Reverted afterwards.
- Status: closed for the routes that exist today. Edit and delete endpoints are not built yet and will go through the same function.

## T5. Revoked access keeps working
- Did: no permissions live in the token. The grant is read from the database on every request, so a revoke applies to the very next request with the same token. logout-all and is_active=false also take effect immediately.
- Proof: test "revoke works immediately with the same token", and the logout-all test.
- Status: closed.

## T6. The audit trail is rewritten by someone with full database access
- Did: hash chain, so editing, removing or reordering a record in the middle is detected by "Verify audit chain" on the admin page.
- Knowingly accepted: the chain only proves the records are consistent with each other. Someone with the database owner role could rewrite everything and recompute every hash, or delete the newest records, and the chain would still verify. The app connects with the same owner role that created the tables.
- Would do next: run the app as a role that has only INSERT and SELECT on audit_log, and copy the latest hash somewhere the database owner cannot reach.
- Status: partly closed.

## T7. A refused action goes unrecorded, or the record disagrees with what happened
- Did: authorize() writes the audit record for every decision. If the audit write fails, the request fails, so there is no access without a record. Upload and grant changes write their audit row in the same transaction as the change. A download is recorded as "allowed" only after the file was read; if the read fails it is recorded as refused with the reason storage_read_failed (tested).
- Knowingly accepted: the record is written after the file is read and before it is sent. If the connection drops while the file is being sent, the server cannot know the user did not receive it.
- Status: closed apart from the dropped-connection case.

## T8. Guessing passwords
- Did: bcrypt with cost 12, 10 login attempts per 15 minutes per client address, the same error message and a dummy hash comparison for unknown emails so neither the message nor the response time shows which emails exist. Every failed login is recorded with the reason.
- Knowingly accepted: the limit is per address, not per account, and lives in the server's memory, so it resets when the server restarts and does not stop an attacker who rotates addresses. There is no account lockout, because lockout lets anyone lock a colleague out. No password complexity rules or two-factor sign-in.
- Status: partly closed.

## T9. A stolen or forged token
- Did: tokens expire after one hour, only HS256 is accepted (a token with algorithm "none" is rejected, tested), the secret must be at least 32 characters or the server refuses to start. The user is loaded from the database on every request, so a role change, deactivation or "Logout (all devices)" applies immediately.
- Knowingly accepted: the token is kept in sessionStorage, so a script injection would be able to read it. Mitigation: the interface writes all user-controlled text with textContent, never as HTML, and helmet sets a Content-Security-Policy. I chose this over cookies to avoid CSRF. There is no way to revoke a single token, only all of a user's tokens.
- Status: partly closed.

## T10. Uploading something harmful, or something that fills the system
- Did: allowed types are PDF, PNG, JPG and TXT, checked by extension and by the real first bytes. 5 MB limit, one file per request. File names are stripped of paths and unusual characters. Files are stored under a random name, encrypted (AES-256-GCM), and always served as a download with a generic content type, never displayed by the browser.
- Knowingly accepted: no virus scanning. A TXT check only rejects binary content. No per-user storage quota, so an owner could fill the database with many 5 MB files.
- Status: partly closed.

## T11. Probing which documents exist
- Did: ids are random UUIDs, a malformed id and a refused id return the same 404 as a missing document (tested), and search returns only what the user may see because the filter is inside the SQL.
- Knowingly accepted: a refused request and a missing one do slightly different database work, so a very precise timing measurement could in theory tell them apart. Owners can also tell whether an email belongs to an active non-admin user, because granting to it succeeds or fails. They need that to share at all.
- Status: partly closed.

## T12. Secrets and keys
- Did: no secrets in the repository (checked with git ls-files), all secrets are environment variables, database connection uses verified TLS.
- Knowingly accepted: one encryption key for all files, no rotation. If STORAGE_KEY is lost the files cannot be opened. The demo passwords are public, on purpose, because the challenge needs credentials in the README. They protect fake data only.
- Status: partly closed.

## T13. Tests run against the live database
- Known weakness: the tests use the same Neon database as the deployed system, so test documents and audit rows can appear in the live system. Documents are cleaned up after the tests, audit rows cannot be deleted by design.
- Would do next: a separate database for tests.
- Status: knowingly accepted.

## T14. Features that do not exist yet
- Edit and delete endpoints are not built, so the "edit" permission is stored but nothing uses it yet. Deactivating a user has no endpoint (is_active exists in the database). No sharing with people outside the company, versions, retention, or AI suggestions.
- Each of these will go through authorize() when built. Until then there is nothing to attack, but there is also no feature.
- Status: not built.