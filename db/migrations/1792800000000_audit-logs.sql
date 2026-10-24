-- Up Migration
-- One row per security-relevant request: who did what, from where, and how it ended.
CREATE TABLE audit_logs (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- NULL when nobody is known (a failed login, for example). Deliberately NOT a foreign key:
  -- the log must outlive the user it describes, and must never stop a user from being removed.
  user_id     UUID,
  action      TEXT NOT NULL,
  outcome     TEXT NOT NULL CHECK (outcome IN ('success', 'failure')),
  status_code INTEGER NOT NULL,
  ip_address  TEXT,
  metadata    JSONB NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Newest first, the order the admin endpoint reads in. Also serves the keyset cursor.
CREATE INDEX audit_logs_created_idx ON audit_logs (created_at DESC, id DESC);
CREATE INDEX audit_logs_user_idx ON audit_logs (user_id, created_at DESC);
CREATE INDEX audit_logs_action_idx ON audit_logs (action, created_at DESC);

-- Append-only: rows can be added but never changed or removed, not even by the application.
-- (A database superuser can still drop the trigger, so this stops mistakes and bugs,
-- not a determined insider. Real systems also ship the log to separate storage.)
CREATE FUNCTION audit_logs_block_change() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs is append-only' USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_logs_append_only
  BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION audit_logs_block_change();

-- Down Migration
DROP TRIGGER audit_logs_append_only ON audit_logs;
DROP FUNCTION audit_logs_block_change();
DROP TABLE audit_logs;
