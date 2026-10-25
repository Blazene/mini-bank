# Frontend API handoff

Day 24 completed the backend review/demo work. The initial React client is now implemented
in `frontend/`; see [frontend setup and scope](frontend.md). Use the existing API; do not quietly change backend money or permission rules
to simplify a screen.

## Public configuration and browser access

- API base: `https://mini-bank-api-2bxt.onrender.com/api/v1`.
- Contract: [OpenAPI](https://mini-bank-api-2bxt.onrender.com/api/v1/openapi.json),
  [interactive Swagger](https://mini-bank-api-2bxt.onrender.com/api/v1/docs/).
- Only the public API base belongs in frontend environment variables. **Never** copy
  `DATABASE_URL`, database passwords, `JWT_SECRET`, deploy hooks or cloud credentials there.
- The frontend is bundled into the existing Render Docker service with `VITE_API_BASE=/api/v1`.
  Website/API share an origin, so leave production `CORS_ORIGINS` unset. No separate static
  host or cross-origin permission is needed. The Vite local development proxy is configured
  in `frontend/vite.config.ts`; it is not used in production.
  CORS is not a bypass for authentication and is not a reason to disable guards.
- Keep the public educational/no-real-money warning visible. Handle free-tier wake-ups
  with a clear loading/retry state, not rapid automatic polling or repeated registration.

## API client invariants

1. Use bearer Authorization, not cookie sessions or `credentials: include`. Start with a
   token held in memory and login again after reload/expiry; there is no refresh endpoint.
   Do not persist tokens to localStorage or log HTTP bodies/headers without a deliberate
   security design. A 401 should clear client auth state and prompt login, not replay a
   money operation with a new key.
2. Treat backend responses as authoritative. Use `/auth/me` for current user information;
   hiding an admin button does not replace server authorization. There is no public role-grant API.
3. Each new deposit/withdrawal/transfer/application intent gets one stable UUID-like
   `Idempotency-Key`. Reuse it for the same payload after network uncertainty; never change
   payload or generate a new key just because a response was lost. Disable duplicate submits.
   A replay's transaction is stable but its account balance/application review can be current.
4. All amounts are integer **paise**. Convert displayed rupees without floating-point rounding
   errors; reject excess decimal places and unsafe integers. **100000 paise = Rs 1,000**.
   Never send a formatted currency string to the API.
5. Error envelope is `{ "error": { "code": "...", "message": "...", "details": ... } }`.
   Details are optional. Distinguish 400 validation, 401 login, 403 role, 404 absent/not-owned,
   409 conflict, 422 business refusal and 429 rate limiting. Honor Retry-After; do not log tokens.
6. Preserve opaque pagination cursors exactly, reset them when filters change, and do not
   decode/re-encode timestamps through JavaScript Date. Render masked counterparty data as
   returned; do not attempt to reconstruct hidden account ids/numbers.
7. Render review reasons/validation strings as text (React escaping), not injected HTML.
   Keep arbitrary backend data out of `dangerouslySetInnerHTML`.

## Customer screens implemented in the first phase

| Screen                 | Existing API / behavior                                                                    |
| ---------------------- | ------------------------------------------------------------------------------------------ |
| Register / login       | `/auth/register`, `/auth/login`, `/auth/me`; no email reset/verification flow yet          |
| Account dashboard      | Create/list/read own accounts; show currency/status and integer-paise balances             |
| Money forms            | Deposit, withdraw, transfer by recipient account number; stable retry key and confirmation |
| Transaction history    | Owner-scoped history, filters and keyset pagination                                        |
| Loan quote/application | Saved terms, indicative eligibility, pending/review status; never imply disbursement       |
| Admin views (later)    | Existing review/audit/monitoring routes; no UI privilege escalation/setup control          |

There are no list-all loan applications, logout/revoke-token, account-freeze, repayment or
loan-disbursement APIs to invent client-side. Keep returned application ids for detail
navigation until a separately scoped backend listing endpoint is designed.

Before frontend publishing: verify same-origin API calls and closed cross-origin CORS, loading/error/empty states,
keyboard accessibility, money parsing, stable retries after timeout, 401 expiry, role denial
and browser storage/log privacy. Do not create new paid resources or change the cloud
security configuration without a deployment decision.
