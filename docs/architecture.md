# Architecture

## Database schema

```mermaid
erDiagram
  USERS ||--o{ ACCOUNTS : owns
  ACCOUNTS ||--o{ TRANSACTIONS : "sends or receives"
  USERS {
    uuid id PK
    text email UK
    text full_name
    text password_hash
    text role
  }
  ACCOUNTS {
    uuid id PK
    uuid user_id FK
    text account_number UK
    text type
    bigint balance
    text status
  }
  TRANSACTIONS {
    uuid id PK
    text type
    uuid from_account_id FK
    uuid to_account_id FK
    bigint amount
    text idempotency_key
  }
```

Money is stored as integer paise in `BIGINT` columns. The database enforces non-negative balances, positive amounts, and valid transaction shapes with `CHECK` constraints.
