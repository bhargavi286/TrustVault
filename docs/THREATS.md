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