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