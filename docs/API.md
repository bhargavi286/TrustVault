# API

Base URL: https://trustvault-3vq3.onrender.com

Every endpoint except `/health` and `POST /api/auth/login` needs `Authorization: Bearer <token>` (the token comes from login). The server decides access on every request; the token carries only the user id.

A document the caller may not reach returns the same 404 as one that does not exist. Every call that touches a document is written to the audit log, refused ones included.

## Public

| Method and path | Who | What |
|---|---|---|
| GET `/health` | anyone | Returns `{"status":"ok"}` |
| POST `/api/auth/login` | anyone, 10 attempts per 15 minutes per address | Body `{email, password}`. Returns `{token, role}`. 401 for any failure, same message every time |

## Any signed-in user

| Method and path | What |
|---|---|
| GET `/api/auth/me` | Returns id, email and role of the caller |
| POST `/api/auth/logout-all` | Invalidates every token ever issued to the caller |
| GET `/api/documents` | Lists documents the caller owns or holds an active grant for. Query: `q` (name), `owner` (owner email), `category`, `from` and `to` (YYYY-MM-DD). Admin gets an empty list |
| GET `/api/documents/:id/download` | Allowed for the document's owner and for users with an active `read` or `edit` grant. Everyone else, including admin: 404. Served as a download, never displayed in the browser |

## Owner role only

| Method and path | What |
|---|---|
| POST `/api/documents` | Multipart upload, fields `file` and optional `category`. PDF, PNG, JPG, TXT up to 5 MB, checked by extension and file bytes. 201 on success, 400 for a rejected file, 413 too large. Admin and viewer get 403 |

## Document owner only

These are allowed only for the owner of that document. Anyone else, including other owners and admin, gets 404.

| Method and path | What |
|---|---|
| GET `/api/documents/:id/grants` | Lists who currently has access |
| POST `/api/documents/:id/grants` | Body `{email, permission}` with permission `read` or `edit`. Grants or changes access. Cannot grant to yourself, to an admin, or to an inactive user (400) |
| DELETE `/api/documents/:id/grants/:userId` | Takes access away. Applies to that user's very next request, with the token they already hold |

## Admin role only

Other roles get 403, and the attempt is written to the audit log.

| Method and path | What |
|---|---|
| GET `/api/admin/summary` | Last 24 hours: refused attempts, failed logins, grants, revokes, and users with 5 or more refusals |
| GET `/api/admin/audit` | Latest 100 audit records with actor, action, outcome, document name, target user, IP. Query: `outcome` (allowed or denied), `action` (text match) |
| GET `/api/admin/verify` | Recomputes the whole audit hash chain. Returns `{total, intact, first_bad_id}` |

## Not built

Edit and delete of documents, user management, sharing outside the company. The `edit` permission is stored but nothing uses it yet.