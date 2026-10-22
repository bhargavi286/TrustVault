-- ENCRYPTED FILE BYTES (kept in the database so they survive redeploys)
CREATE TABLE IF NOT EXISTS file_blobs (
  storage_key text PRIMARY KEY,
  data        bytea NOT NULL
);

-- USERS
CREATE TABLE IF NOT EXISTS users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email         text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  role          text NOT NULL CHECK (role IN ('admin', 'owner', 'viewer')),
  token_version integer NOT NULL DEFAULT 0,
  is_active     boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- DOCUMENTS (metadata only; the file itself is stored encrypted elsewhere)
CREATE TABLE IF NOT EXISTS documents (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id    uuid NOT NULL REFERENCES users(id),
  name        text NOT NULL,
  category    text NOT NULL DEFAULT 'general',
  mime_type   text NOT NULL,
  size_bytes  bigint NOT NULL,
  sha256      text NOT NULL,
  storage_key text NOT NULL UNIQUE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  deleted_at  timestamptz
);
CREATE INDEX IF NOT EXISTS idx_documents_owner ON documents(owner_id);

-- GRANTS (per-document access)
CREATE TABLE IF NOT EXISTS grants (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid NOT NULL REFERENCES documents(id),
  user_id     uuid NOT NULL REFERENCES users(id),
  permission  text NOT NULL CHECK (permission IN ('read', 'edit')),
  granted_by  uuid NOT NULL REFERENCES users(id),
  granted_at  timestamptz NOT NULL DEFAULT now(),
  revoked_at  timestamptz
);
-- only one active grant per (document, user)
CREATE UNIQUE INDEX IF NOT EXISTS uq_active_grant
  ON grants(document_id, user_id) WHERE revoked_at IS NULL;

-- AUDIT LOG (append-only, hash chained)
CREATE TABLE IF NOT EXISTS audit_log (
  id             bigserial PRIMARY KEY,
  ts             timestamptz NOT NULL DEFAULT now(),
  actor_id       uuid,
  action         text NOT NULL,
  outcome        text NOT NULL CHECK (outcome IN ('allowed', 'denied')),
  document_id    uuid,
  target_user_id uuid,
  ip             text,
  details        jsonb NOT NULL DEFAULT '{}'::jsonb,
  prev_hash      text NOT NULL,
  hash           text NOT NULL
);

-- Hash chain: the database computes the hash, not the app
CREATE OR REPLACE FUNCTION audit_chain() RETURNS trigger AS $$
DECLARE
  last_hash text;
BEGIN
  PERFORM pg_advisory_xact_lock(90210);
  SELECT hash INTO last_hash FROM audit_log ORDER BY id DESC LIMIT 1;
  NEW.prev_hash := COALESCE(last_hash, repeat('0', 64));
  NEW.hash := encode(sha256(convert_to(concat_ws('|',
    NEW.prev_hash,
    NEW.id::text,
    to_char(NEW.ts AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US'),
    COALESCE(NEW.actor_id::text, ''),
    NEW.action,
    NEW.outcome,
    COALESCE(NEW.document_id::text, ''),
    COALESCE(NEW.target_user_id::text, ''),
    COALESCE(NEW.ip, ''),
    NEW.details::text
  ), 'UTF8')), 'hex');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_audit_chain ON audit_log;
CREATE TRIGGER trg_audit_chain
  BEFORE INSERT ON audit_log
  FOR EACH ROW EXECUTE FUNCTION audit_chain();

-- Block UPDATE / DELETE / TRUNCATE on the audit log
CREATE OR REPLACE FUNCTION audit_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_log is append-only';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_audit_no_change ON audit_log;
CREATE TRIGGER trg_audit_no_change
  BEFORE UPDATE OR DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION audit_immutable();

DROP TRIGGER IF EXISTS trg_audit_no_truncate ON audit_log;
CREATE TRIGGER trg_audit_no_truncate
  BEFORE TRUNCATE ON audit_log
  FOR EACH STATEMENT EXECUTE FUNCTION audit_immutable();