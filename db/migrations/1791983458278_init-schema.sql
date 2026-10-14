-- Up Migration
CREATE TABLE users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email         TEXT NOT NULL,
  full_name     TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX users_email_unique ON users (lower(email));

CREATE TABLE accounts (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        UUID NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  account_number TEXT NOT NULL UNIQUE,
  type           TEXT NOT NULL CHECK (type IN ('savings', 'current')),
  balance        BIGINT NOT NULL DEFAULT 0 CHECK (balance >= 0),
  currency       CHAR(3) NOT NULL DEFAULT 'INR',
  status         TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'frozen', 'closed')),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX accounts_user_id_idx ON accounts (user_id);

CREATE TABLE transactions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type            TEXT NOT NULL CHECK (type IN ('deposit', 'withdrawal', 'transfer')),
  from_account_id UUID REFERENCES accounts (id),
  to_account_id   UUID REFERENCES accounts (id),
  amount          BIGINT NOT NULL CHECK (amount > 0),
  status          TEXT NOT NULL DEFAULT 'completed' CHECK (status IN ('pending', 'completed', 'failed')),
  idempotency_key TEXT,
  description     TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (
    (type = 'deposit'    AND to_account_id IS NOT NULL AND from_account_id IS NULL) OR
    (type = 'withdrawal' AND from_account_id IS NOT NULL AND to_account_id IS NULL) OR
    (type = 'transfer'   AND from_account_id IS NOT NULL AND to_account_id IS NOT NULL
                         AND from_account_id <> to_account_id)
  )
);
CREATE UNIQUE INDEX transactions_idempotency_unique
  ON transactions (COALESCE(from_account_id, to_account_id), idempotency_key)
  WHERE idempotency_key IS NOT NULL;
CREATE INDEX transactions_from_idx ON transactions (from_account_id, created_at DESC);
CREATE INDEX transactions_to_idx ON transactions (to_account_id, created_at DESC);

-- Down Migration
DROP TABLE transactions;
DROP TABLE accounts;
DROP TABLE users;
