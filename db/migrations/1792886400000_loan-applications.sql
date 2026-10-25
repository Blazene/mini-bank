-- Up Migration
CREATE TABLE loan_applications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),
  principal BIGINT NOT NULL CHECK (principal BETWEEN 100000 AND 100000000),
  tenure_months INTEGER NOT NULL CHECK (tenure_months BETWEEN 6 AND 360),
  monthly_income BIGINT NOT NULL CHECK (monthly_income BETWEEN 1 AND 100000000),
  existing_monthly_emi BIGINT NOT NULL CHECK (existing_monthly_emi BETWEEN 0 AND 100000000),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status = 'pending'),
  -- Server-generated terms are saved, never recalculated when the application is read.
  quote JSONB NOT NULL CHECK (jsonb_typeof(quote) = 'object'),
  idempotency_key TEXT NOT NULL CHECK (idempotency_key ~ '^[A-Za-z0-9_.:-]{8,100}$'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, idempotency_key)
);
CREATE INDEX loan_applications_user_idx ON loan_applications (user_id, created_at DESC, id DESC);

-- Down Migration
DROP TABLE loan_applications;
