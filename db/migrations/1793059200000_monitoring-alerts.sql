-- Up Migration
CREATE TABLE monitoring_alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id UUID NOT NULL REFERENCES transactions(id),
  account_id UUID NOT NULL REFERENCES accounts(id),
  rule_code TEXT NOT NULL CHECK (rule_code IN ('LARGE_TRANSACTION', 'RAPID_TRANSFERS')),
  severity TEXT NOT NULL CHECK (severity IN ('medium', 'high')),
  details JSONB NOT NULL CHECK (jsonb_typeof(details) = 'object'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (transaction_id, rule_code)
);
CREATE INDEX monitoring_alerts_created_idx ON monitoring_alerts (created_at DESC, id DESC);
CREATE INDEX monitoring_alerts_account_idx ON monitoring_alerts (account_id, created_at DESC, id DESC);
CREATE INDEX monitoring_alerts_rule_idx ON monitoring_alerts (rule_code, created_at DESC, id DESC);

-- Down Migration
-- Deliberately refuse to silently delete existing monitoring evidence.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM monitoring_alerts) THEN
    RAISE EXCEPTION 'Cannot undo monitoring migration while alerts exist';
  END IF;
END $$;
DROP TABLE monitoring_alerts;
