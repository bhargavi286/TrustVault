# TrustVault

Secure document sharing with a real audit trail. Built for the Snovasys Fresher Hiring Challenge 2026.

**Live:** https://trustvault-3vq3.onrender.com
(Free hosting sleeps when idle. The first request can take up to a minute.)

## Demo accounts

These are public demo accounts with fake data.

| Role | Email | Password |
|---|---|---|
| Admin | admin@trustvault.test | Admin-Demo-2026! |
| Owner | alice@trustvault.test | Alice-Demo-2026! |
| Owner | bob@trustvault.test | Bob-Demo-2026! |
| Viewer | carol@trustvault.test | Carol-Demo-2026! |
| Viewer | dave@trustvault.test | Dave-Demo-2026! |

## What each role can do
- **Owner**: uploads documents, searches, downloads, renames and deletes own documents, grants and revokes read or edit access to named people.
- **Viewer**: sees and downloads only documents that were granted to them. Cannot upload or share.
- **Admin**: sees activity, permission changes and refused attempts, and can verify the audit chain. Never sees document contents.

## Permission model

- Per-document grants (`read` or `edit`) to named users. No folders, no groups, no inheritance, so there is exactly one place to reason about.
- Only the owner can share or revoke. Admin has no content access.
- Default deny. Every document route calls `authorize()` in `src/services/access.js`, the single place where access is decided.
- A document you are not allowed to reach returns the same 404 as one that does not exist.
- Revoking works on the very next request. Permissions are read from the database on every request, never from the token.
- Every attempt, allowed or refused, is written to the audit log.

## Audit trail

`audit_log` is append-only. Database triggers reject UPDATE, DELETE and TRUNCATE. Each row stores the hash of the previous row, computed by the database. The admin page has a "Verify audit chain" button that recomputes the whole chain.

## Stack

Node.js, Express, PostgreSQL (Neon), vanilla JS front end, Jest and Supertest. Files are stored AES-256-GCM encrypted inside PostgreSQL. Hosted on Render.

## Run it locally

```
git clone https://github.com/bhargavi286/TrustVault.git
cd TrustVault
npm install
```

Create a `.env` file:

```
DATABASE_URL=postgresql://...        (a Postgres database, for example a free Neon project)
JWT_SECRET=                          (any random string of 32+ characters)
STORAGE_KEY=                         (64 hex characters)
```

Generate the two secrets with:

```
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Then:

```
node db/setup.js     # creates the tables
node db/seed.js      # creates the demo users
npm start            # http://localhost:3000
npm test             # runs the security tests against the database in .env
```

## Deploy on Render

New Web Service from the GitHub repo. Build command `npm install`, start command `npm start`, health check path `/health`. Set `DATABASE_URL`, `JWT_SECRET` and `STORAGE_KEY` as environment variables. Choose a region close to the database.

## Documents

- `docs/THREATS.md`: threats, what was done, what was knowingly accepted
- `PROMPTS.md`: how AI was used and where it was wrong
- `db/schema.sql`: database schema

## What is not built yet
Restoring deleted documents, versions, replacing a document's contents, user management, sharing with people outside the company, retention, AI suggestions for who should see a document. See THREATS.md for the reasoning.