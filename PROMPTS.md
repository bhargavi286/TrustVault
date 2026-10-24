# PROMPTS.md

How I used AI while building TrustVault, and where it was wrong. Each entry says what I asked, what came back, what was wrong, and what I did instead.

I used Claude as a step-by-step pair programmer in one long chat. I ran every command and test myself and pasted the real output back. Where the AI caught its own mistake, the entry says so.

## Rules the build followed

These came from the first planning message and I held the code to them:

- The server decides access on every request. Hiding a button does not count.
- All document access goes through one function, `authorize()` in `src/services/access.js`.
- Default deny. A document you cannot reach returns the same 404 as one that does not exist.
- Refused attempts go into the audit log too.
- Only parameterised SQL. Permissions are read from the database on every request, never from the token.

## Entries

### 2026-10-21: creating the project folders (not security related)
- Asked: how to create the src, tests, db and docs folders.
- Produced: `mkdir src src/routes src/middleware ...` (bash style).
- Wrong: I use Windows PowerShell, where mkdir does not take space-separated paths. It failed with "A positional parameter cannot be found".
- Did instead: comma-separated paths. Command only, no code change. Commit of the resulting project: 1685d41

### 2026-10-22: a failing test that was the test's fault
- Asked: Jest and Supertest tests showing one user cannot reach another's documents, that revoke works, and that refusals are audited.
- Produced: 23 tests. 22 passed, 1 failed: "owner can download her own document", `res.text` was `undefined`.
- Wrong: the app was right and the test was wrong. Downloads are served as `application/octet-stream`, and Supertest does not fill `res.text` for that type. Changing the app to satisfy the test would have been the wrong fix.
- Did instead: the test reads the response as a binary buffer. Commit: 48fedfc

### 2026-10-22: do the tests really test authorisation? (authorisation)
- Asked: tests for cross-user access. The AI produced them and suggested a mutation check.
- What I did: I made `decide()` in `src/services/access.js` return `true` as its first line and ran the tests. 8 of 23 failed (another owner, viewer, admin, re-share by a non-owner, audit of refusals). 15 still passed.
- What I learned: the list and search test and the viewer upload test still passed because those routes are protected by separate layers (the filter inside the SQL, and the role check). That is sound design, but those two tests say nothing about `authorize()`, so I do not count them as proof of it.
- Did instead: reverted with `git checkout`, and wrote the result into THREATS.md (T4). Commit: b60ad5e

### 2026-10-22: previous user's document name stayed on screen after logout (access control)
- Asked: a minimal web UI for login, list, upload, share and revoke.
- Produced: `public/app.js` where logout only hid the main panel.
- Wrong: I tested sharing as Alice, logged out, and logged in as Carol. The "Access to: ..." panel with Alice's document name was still on Carol's screen. The server did not leak the contents (the access list route is owner-only and returns 404 to anyone else), but one user's file name showed up for another user.
- Did instead: `showLogin()` now clears the share panel, document list, audit table and form fields, and the share panel is hidden at start. Commit: d127eb3

### 2026-10-22: audit records would all show the proxy's IP (audit trail)
- Asked: Claude to plan the Render deployment.
- Produced: while planning, Claude pointed out a problem in its own earlier code. `authorize()` and the login route store `req.ip` in the audit record and use it as the rate-limit key. Behind Render's proxy that is the proxy's address for every request, so audit records would lose the real client IP and all users would share one login rate-limit counter.
- Wrong: the original app ignored the proxy. I checked both places in the code before applying the fix.
- Did instead: `app.set('trust proxy', 1)` in `src/app.js`, because Render puts exactly one proxy in front. Commit: 524f0e5

### 2026-10-22: uploaded files would disappear on Render (deployment)
- Asked: Claude to plan the deployment.
- Produced: Claude noted that its own `storage.js` wrote encrypted files to the server's disk, which Render's free plan does not keep across restarts. The database rows would stay and downloads would fail with 500.
- Wrong: the storage design did not fit the hosting. This was caught by the AI at planning time, not by me.
- Did instead: the encrypted bytes now live in a `file_blobs` table in PostgreSQL, still AES-256-GCM encrypted. I updated the "stored file bytes do not contain the plain text" test to read from the database. Commit: 4851f75

### YYYY-MM-DD: a download recorded as "allowed" even when nothing was delivered (audit trail)
- Asked: the download route, with every decision written to the audit log.
- Produced: `authorize()` wrote the "allowed" record first, and the route read the file afterwards.
- Wrong: when I asked Claude to re-read its own code it flagged the order. If reading the file fails, the audit trail says "allowed" while the user got a 500, so the record disagrees with what happened. I wrote a test first that deletes a document's stored bytes and then downloads it. It failed (`Expected: 0, Received: 1`), which proved the problem was real.
- Did instead: `authorize()` takes `{ deferAllowed: true }` and the route calls `recordAllowed()` only after the file was read. A failed read is recorded as refused with the reason `storage_read_failed`. Commit: 29cb7d2

### YYYY-MM-DD: the fix did not run, and a weak test hid a missing route (access control)
- Asked: Claude to replace the download route with the fixed one.
- Produced: edit instructions that were ambiguous. I pasted the new route in, but the old download route was still in the file, and the route that lists who has access was gone.
- Wrong: the test still failed after the fix, with the same line number in the stack trace as before. Searching for the route definitions showed two `/:id/download` routes. Express uses the first one, so the old code kept running. The test "non-owner cannot see or change who has access" still passed with the access-list route missing, because a missing route also answers 404. The test could not tell "refused" from "does not exist".
- Did instead: replaced the whole file so there is one route per path, and added a test that the owner can list who has access. Commit: 29cb7d2
## Known gaps I have not fixed yet


- The app connects to the database as the owner role, so the audit triggers could be dropped by someone with that role (THREATS.md T6).