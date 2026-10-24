# TrustVault write-up

Live: https://trustvault-3vq3.onrender.com  |  Code: https://github.com/bhargavi286/TrustVault

## What I built

A document sharing platform with three roles (admin, owner, viewer). Owners upload documents and grant or take back read or edit access for named people. Viewers see only what was granted to them. Admins see activity, permission changes and refused attempts, and can verify the audit trail, but never see document contents. Documents can be searched by name, owner, category and date. Uploads are validated by extension and by the real bytes of the file. Files are stored encrypted. Every attempt to reach a document, allowed or refused, is written to an audit log.

Stack: Node.js and Express, PostgreSQL on Neon, plain JavaScript front end, Jest and Supertest, hosted on Render.

## My permission model

Per-document grants. A document belongs to its owner. The owner can grant `read` or `edit` to a named user, and take it back. Nothing else gives access.

- Default deny. Every route that touches a document calls one function, `authorize()` in `src/services/access.js`. That is the only place where access is decided.
- Only the owner can share or revoke. A user holding a read grant cannot pass it on.
- Admin has no access to content. An admin account that is stolen still cannot read a document.
- A document you may not reach returns the same 404 as one that does not exist, so ids cannot be probed.
- Nothing about permissions is stored in the token. The user and the grant are read from the database on every request.

Why per-document grants and no folders or groups: I wanted one place to reason about. Folder inheritance is where "access to one folder shows forty files" comes from, and I preferred a smaller model I could test completely.

What "taking access away immediately" costs: two database lookups on every request (the user, and the grant), and no caching. That is slower, but a revoke applies to the very next request, with the token the person already holds. This is tested.

## How the audit trail is protected

`audit_log` is append-only: database triggers reject UPDATE, DELETE and TRUNCATE. Each row stores the hash of the previous row, and the database computes it, not the application. The admin page has a "Verify audit chain" button that recomputes the whole chain. Refused attempts, failed logins, rejected tokens and grants are all recorded. If an audit write fails, the request fails, so there is no access without a record.

## What I deliberately did not build

Folders, groups and inheritance (see above). Sharing with people outside the company, versions, retention and recovery, edit and delete endpoints, user management screens, two-factor sign-in, revoking a single token. The AI suggestion for who should see a document is not built; if I built it, it would only suggest, a person would confirm, and both the suggestion and the decision would go into the audit log.

## How I used AI, and where it was wrong

I used Claude as a step-by-step pair programmer in one long chat, and ran every command and test myself. PROMPTS.md has the dated entries. The ones that mattered:

- A mutation check on my own tests: I made the authorisation function return `true`. 8 of the 23 tests I had at that point failed, so those tests do check it. Two tests still passed, because other layers protect those routes, so I do not count them as proof.
- A fix I applied did not take effect: the old download route was still in the file, and Express uses the first matching route. A weak test also passed while the access-list route was missing, because "does not exist" and "refused" both answer 404.
- The first download code recorded "allowed" before reading the file. I wrote a test that deletes a document's stored bytes first, saw it fail, then fixed the order.
- Logout left the previous user's document name on screen. The server leaked nothing, but one user's file name appeared for the next user.
- Deployment problems: audit records would all have shown the proxy's IP, and files stored on disk would vanish on Render.

## What is unfinished or weak

THREATS.md has the full list. The main ones:

- The app connects to the database as the owner role, so someone with that role could drop the audit triggers or rewrite the log. The chain cannot detect deletion of the newest records. A role with INSERT and SELECT only, and an external copy of the latest hash, would close this.
- The login limit is per address and in memory, with no account lockout and no two-factor sign-in.
- The token is kept in sessionStorage, so a script injection could read it.
- No virus scanning and no per-user storage quota.
- The tests run against the same database as the live system.
- Edit and delete are not built, so the `edit` permission is stored but unused.