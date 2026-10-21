# PROMPTS.md

Log of how I used AI while building TrustVault. Each entry: what I asked, what it produced, what was wrong, what I did instead (with commit).

## Reused context (instructions I give the AI every time)

- Server decides access on every request. UI checks do not count.
- All document access goes through one function, canAccess(user, doc, action).
- Default deny. Return 404 (not 403) for documents the user has no access to.
- Refused attempts must be written to the audit log too.
- Parameterised SQL only.

## Entries

### 2026-10-21 - Folder setup commands (not security related)
- Asked: how to create the project folders (src, src/routes, tests, db, docs).
- Produced: `mkdir src src/routes src/middleware ...` (bash style).
- Wrong: I use Windows PowerShell, where mkdir does not accept space-separated paths. It failed with "positional parameter cannot be found".
- Did instead: used comma-separated paths. Commit: <paste hash from git log --oneline>

(More entries to add as I go. At least 2 must be about authorisation or the audit trail.)