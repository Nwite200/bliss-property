# Bliss Legacy Limited — API Documentation

**Base URL (local):** `http://localhost:8787`

**Base URL (deployed demo):** `https://bliss-legacy-limited.easterntechexpo.workers.dev`

All APIs are served by the Cloudflare Worker in `src/index.js`. JSON responses use `Content-Type: application/json`. Authentication is a session cookie named `bliss_session`.

---

## 1. Authentication model

- Session cookie flags: `HttpOnly; Secure; SameSite=Lax`.
- Session lifetime: 8 hours.
- Login accepts email, client reference or phone number.
- State-changing browser requests must pass `csrfOk`:
  - `Origin` host must match `Host`;
  - `Sec-Fetch-Site`, when present, must be `same-origin`, `same-site` or `none`.
- `/api/setup` requires `X-Setup-Secret`.
- `/api/webhooks/wema-alat` requires the provider webhook secret header.

### Error shape

```json
{ "error": "Human-readable message" }
```

Status codes used: `200`, `400`, `401`, `403`, `404`, `409`, `429`, `500`, `503`.

---

## 2. Public and authentication endpoints

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/api/health` | Public | Health check |
| POST | `/api/setup` | `X-Setup-Secret` | Create first MD if no users exist |
| POST | `/api/signup` | Public | Client self-registration and auto-login |
| GET | `/api/referral/:code` | Public | Resolve a staff referral link to the staff member and branch |
| GET | `/api/terms` | Public | Active Terms & Conditions version |
| GET | `/api/terms/document/:id` | Public | Download a Terms & Conditions PDF by version |
| POST | `/api/public/enquiries` | Public | Create a lead from the public website |
| POST | `/api/login` | Public | Staff/client login |
| POST | `/api/logout` | Session optional | Delete session |
| GET | `/api/me` | Any user | Current user, staff profile, client link |
| POST | `/api/password-reset-request` | Public | Create reset token (rate limited) |
| POST | `/api/password-reset` | Public | Consume reset token, revoke sessions |
| POST | `/api/change-password` | Any user | Change own password |

### `POST /api/public/enquiries`

```json
{
  "full_name": "Ada Example",
  "phone_number": "08030000000",
  "email_address": "ada@example.com",
  "message": "I would like a site inspection.",
  "branch_name": "Ikeja",
  "property_reference": "BLP-XXXX",
  "acquisition_mode": "inspection",
  "source": "Homepage contact form"
}
```

Creates a `New Lead` with no staff assignment and no contract price. Returns `{ ok, reference }`.

---

## 3. Staff, branch and team endpoints

| Method | Path | Allowed roles | Purpose |
|---|---|---|---|
| GET | `/api/users` | MD/BM/FO/TL/Marketer | Branch-scoped user directory |
| POST | `/api/users` | MD/BM | Legacy user creation |
| GET | `/api/branches` | Public | Branch list |
| GET | `/api/teams` | MD/BM/TL/Marketer | Team list |
| POST | `/api/teams` | MD/BM | Create team |
| GET | `/api/teams/:id` | MD/BM/TL/Marketer | Team detail |
| PUT | `/api/teams/:id` | MD/BM | Update team/members |
| GET | `/api/staff` | MD/BM | Staff directory |
| POST | `/api/staff` | MD/BM | Create staff account |
| GET | `/api/staff/:id` | MD/BM | Staff detail |
| PUT | `/api/staff/:id` | MD/BM | Update role/branch/profile |
| POST | `/api/staff/:id/status` | MD/BM | Activate/deactivate |
| PUT | `/api/staff/:id/teams` | MD/BM | Replace team memberships |

Role creation limits:

- MD may create Branch Manager, Team Lead, Marketer, Finance Officer.
- BM may create Team Lead, Marketer, Finance Officer in own branch.
- No API creates a second Managing Director.
- The last active MD cannot be deactivated.

---

## 4. Property endpoints

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/api/property-categories` | Public | Category list |
| POST | `/api/property-categories` | MD | Create category |
| GET | `/api/properties` | Public/optional | Search/list; supports `q`, `category`, `location`, `status`, `branch`, `featured`, `is_published`, `page`, `limit` |
| GET | `/api/properties/:id` | Public/optional | Detail, images and (for staff) document metadata |
| POST | `/api/properties` | MD/BM | Create property |
| PUT | `/api/properties/:id` | MD/BM | Update property |
| POST | `/api/properties/:id/status` | MD/BM | Change status |
| GET | `/api/properties/:id/status-history` | Staff | Status history |
| POST | `/api/properties/:id/images` | MD/BM | Upload image (`file`, optional `is_main`) |
| DELETE | `/api/properties/:id/images/:imageId` | MD/BM | Delete image |
| POST | `/api/properties/:id/documents` | MD/BM | Upload private document |
| GET | `/api/properties/:id/documents/:docId/download` | Staff | Download private document |
| DELETE | `/api/properties/:id/documents/:docId` | MD/BM | Delete private document |
| GET | `/api/files/*` | Public/staff | Published property images; unpublished require staff |

### Upload rules

- Images: JPEG, PNG, WebP or GIF; maximum 5MB; magic-byte checked.
- Documents: PDF, JPEG or PNG; maximum 10MB; magic-byte checked.
- Documents are stored under `property-documents/` and are never served by `/api/files/*`.
- Branch Managers may only write/read own-branch records.

---

## 5. Client management endpoints

| Method | Path | Allowed roles | Purpose |
|---|---|---|---|
| GET | `/api/clients` | Staff except Client | Scoped client list |
| POST | `/api/clients` | MD/BM/TL/Marketer | Create client record |
| GET | `/api/clients/:id` | Staff except Client | Detail, assignments, notes, portfolio |
| PUT | `/api/clients/:id` | MD/BM/TL | Update; only MD/BM may change price/property |
| POST | `/api/clients/:id/status` | MD/BM/TL/Marketer | Change status |
| POST | `/api/clients/:id/assign` | MD/BM | Assign manager/branch/team lead |
| POST | `/api/clients/:id/reassign` | MD only | Reassign |
| GET | `/api/clients/:id/status-history` | Staff | Status history |
| GET | `/api/clients/:id/assignment-history` | Staff | Assignment history |
| POST | `/api/clients/:id/notes` | MD/BM/TL/Marketer | Internal note |

Client detail returns:

- `client`
- `properties` (multi-property allocations)
- `financials` (contract, verified, outstanding, progress)
- `assignments`, `assignment_history`, `status_history`, `notes`

---

## 6. Client portal endpoints

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/client/dashboard` | Own dashboard, portfolio, financials, next payment, notifications |
| GET | `/api/client/profile` | Own profile |
| PUT | `/api/client/profile` | Update permitted profile fields |
| GET | `/api/client/property` | Primary property detail |
| GET | `/api/client/payments` | Own non-demo payment history |
| GET | `/api/client/installments` | Own installment schedules |
| GET | `/api/client/virtual-account` | ALATPay account status / readiness |
| POST | `/api/client/virtual-account` | Generate a dedicated ALATPay bank-transfer account |
| GET | `/api/client/receipts` | Own receipts |
| GET | `/api/client/receipts/:id/download` | Own receipt PDF |
| GET | `/api/finance/receipts/:id/download` | MD/FO/BM staff receipt PDF |
| GET | `/api/client/notifications` | Own notifications |
| POST | `/api/client/notifications/:id/read` | Mark one read |
| POST | `/api/client/notifications/read-all` | Mark all read |

Client endpoints are always scoped to the authenticated client. Cross-client access returns `403`.

### ALATPay integration

- Base URL: `https://apibox.alatpay.ng`
- Auth header for server requests: `Ocp-Apim-Subscription-Key: <ALATPAY_SECRET_KEY>`
- Worker secret: `ALATPAY_SECRET_KEY`
- Worker secret: `ALATPAY_BUSINESS_ID`
- Virtual-account endpoint: `POST /bank-transfer/api/v1/bankTransfer/virtualAccount`
- Webhook: `POST /api/webhooks/alatpay`
- Staff-assisted provisioning: `POST /api/finance/clients/:id/virtual-account` (MD/FO/BM)

The webhook re-queries ALATPay with the secret key before crediting any payment. It does not trust an unverified callback payload.

Dedicated/static payment accounts are displayed everywhere as **“Client Name / Bliss Legacy Limited”**, including the client dashboard, client virtual-account page and staff client detail view. Clients without a BVN can still create their account and add the BVN later from My Virtual Account.

### Referral fields

Client onboarding accepts:

- `residential_address`
- `state`
- `city`
- `branch_id` (the client chooses a branch; `assigned_branch_id` is still ignored)
- `identity_type` (`NIN`, `International Passport`, `Driver's License`, `Permanent Voter's Card`) — optional
- `identity_number` (stored only as a masked value, last four digits and a hash) — optional
- `bvn` (used once to provision the client's permanent ALATPay wallet; never stored) — optional
- `alternate_phone`
- `next_of_kin_name`
- `next_of_kin_phone`
- `next_of_kin_relationship`
- `next_of_kin_address`
- `referral_code`
- `terms_accepted` (must be `true`; signup is rejected otherwise)

Terms are versioned. Signup records the accepting client, user, active terms version, IP address and user agent in `terms_acceptances`. Management can publish a new text version or upload a replacement PDF from the System Administration page.

`/api/me` returns `referral_code` and `referral_link` for every staff account. `?ref=CODE` on `signup.html` pre-fills the referral code, shows the referring staff member and preselects their branch (the client can change it). The referred client is automatically assigned to the referring staff member as relationship manager and is visible in that staff member's client scope. Every staff dashboard and the Customer Care dashboard exposes a copy/share referral card with both the link and code.

Client identity review is performed with `POST /api/clients/:id/kyc` (`verified`, `rejected`, `pending`). Permanent virtual-account activation is available to signed-in clients through:

- `POST /api/client/virtual-account/static-wallet/initiate` (`{ bvn }`)
- `POST /api/client/virtual-account/static-wallet/validate` (`{ otp }`)

---

## 7. Finance endpoints

| Method | Path | Allowed roles | Purpose |
|---|---|---|---|
| GET | `/api/finance/overview` | MD/FO/BM | KPIs, recent transactions, provider status |
| GET | `/api/finance/transactions` | MD/FO/BM/TL/Marketer | Role-scoped transaction list |
| POST | `/api/finance/payments` | MD/FO/BM | Record pending manual payment |
| POST | `/api/finance/payments/:id/verify` | MD/FO | Verify, create receipt |
| POST | `/api/finance/payments/:id/adjust` | MD/FO | Refund/reversal with adjustments |
| POST | `/api/finance/payments/:id/fail` | MD/FO | Mark failed |
| GET | `/api/finance/provider-config` | MD/FO/BM | Provider configuration/status |
| POST | `/api/finance/provider-config` | MD/FO | Update configuration |
| POST | `/api/webhooks/wema-alat` | Webhook secret | Idempotent provider webhook |
| POST | `/api/finance/reconciliation` | MD/FO | Match submitted references |

Money is stored as integer kobo. Only verified non-demo NGN payments count as collections.

---

## 8. Installment endpoints

| Method | Path | Allowed roles |
|---|---|---|
| GET | `/api/installments` | MD/BM/FO |
| GET | `/api/installments/:id/history` | MD/BM/FO |
| PUT | `/api/installments/:id` | MD/BM/FO |
| POST | `/api/installments` | MD/BM/FO |
| POST | `/api/installments/:id/cancel` | MD/BM/FO |

Every schedule change writes `payment_schedule_history` and a notification.

---

## 9. Dashboard, analytics, activity and leads

| Method | Path | Allowed roles |
|---|---|---|
| GET | `/api/dashboard` | Staff |
| GET | `/api/analytics/performance` | Staff |
| GET | `/api/activity` | Staff |
| GET | `/api/leads` | MD/BM/TL/Marketer |
| POST | `/api/leads` | MD/BM/TL/Marketer |
| GET | `/api/leads/:id` | MD/BM/TL/Marketer |
| PUT | `/api/leads/:id` | MD/BM/TL/Marketer |
| POST | `/api/leads/:id/status` | MD/BM/TL/Marketer |
| POST | `/api/leads/:id/follow-ups` | MD/BM/TL/Marketer |
| PUT | `/api/leads/:id/follow-ups/:fid` | MD/BM/TL/Marketer |
| POST | `/api/leads/:id/convert` | MD/BM/TL/Marketer |

---

## 10. Commission and report endpoints

| Method | Path | Allowed roles |
|---|---|---|
| GET | `/api/commission-options` | MD/FO |
| GET | `/api/commission-plans` | MD/FO |
| POST | `/api/commission-plans` | MD/FO |
| GET | `/api/commission-plans/:id` | MD/FO |
| PUT | `/api/commission-plans/:id` | MD/FO |
| POST | `/api/commission-plans/:id/status` | MD/FO |
| GET | `/api/commissions` | MD/FO/BM/TL/Marketer |
| POST | `/api/commissions/generate` | MD/FO |
| GET | `/api/commissions/:id` | MD/FO/BM/TL/Marketer |
| POST | `/api/commissions/:id/submit` | MD/FO |
| POST | `/api/commissions/:id/approve` | MD/FO |
| POST | `/api/commissions/:id/reject` | MD/FO |
| POST | `/api/commissions/:id/payments` | MD/FO |
| POST | `/api/commissions/:id/adjustments` | MD/FO |
| GET | `/api/commissions/payments/:id/receipt` | Scoped staff |
| GET | `/api/referral-commissions` | MD/FO/HA/BM/TL/Marketer |
| GET | `/api/referral-commissions/:id` | Scoped staff |
| GET | `/api/referral-commissions/rules` | Scoped staff |
| POST | `/api/referral-commissions/backfill` | MD/FO/HA |
| POST | `/api/referral-commissions/:id/recalculate` | MD/FO/HA |
| POST | `/api/referral-commissions/:id/payments` | MD/FO/HA |
| POST | `/api/referral-commissions/:id/adjustments` | MD/FO/HA |
| POST | `/api/reports` | MD/FO/BM/TL/Marketer |
| GET | `/api/reports` | MD/FO/BM/TL/Marketer |
| GET | `/api/reports/:id/download` | Owner or MD/FO |

Report types: `sales`, `collections`, `outstanding`, `commission`, `branch_performance`, `marketer_performance`, `refunds`, `commission_liability`.

### ELPIS referral commission automation

Referral commission is calculated automatically from verified non-demo NGN payments, using the client's locked payment plan duration:

- **More than 8 months:** two-stage commission on cumulative qualifying payments. The first ₦60,000 earns a maximum of ₦20,000 (fixed cap, no 33.333% rounding drift); the next ₦60,000 earns 25% (₦15,000). Commission stops at ₦120,000 paid and a maximum of ₦35,000 per client.
- **7 months or less:** 10% of verified qualifying payments.
- **Outright purchase:** 10% of the verified purchase amount.
- **Exactly 8 months:** the account is flagged `Configuration Required` until management confirms the policy. No commission is generated.

The calculation is cumulative and stage-based, not calendar-month-based. Re-running a calculation is idempotent: `TotalCommissionEarnedToDate - PreviouslyRecognisedCommission`. Payment reversals, refunds and cancellations automatically reduce the ledger. Rules are seeded and read-only; only authorised management/finance roles can disburse or adjust commission. Every calculation, flag, reversal, adjustment and disbursement is written to an immutable event ledger.

Marketers may generate only `commission` and `commission_liability`. Team Leads cannot generate `branch_performance`.

---

## 11. Super Admin, staff notifications and chat

### Super Admin

- `GET /api/admin/overview` — permission `admin.system`
- `GET /api/admin/roles` — permission `admin.roles`
- `PUT /api/admin/roles/:id/permissions` — permission `admin.permissions`; actual Super Admin only
- `GET /api/admin/audit` — permission `admin.audit`
- `GET /api/admin/clients` — permission `admin.system`; paginated client signup records including address, branch, identity/KYC, referral attribution, plan and accepted terms version
- `GET /api/admin/terms` — permission `settings.manage`; active terms and version history
- `POST /api/admin/terms` — permission `settings.manage`; publish a text version and/or upload a replacement PDF
- `POST /api/admin/terms/:id/activate` — permission `settings.manage`; roll back to a previous version

Super Admin inherits MD business scope for backward compatibility. `/api/me` returns both `role` (effective MD) and `actual_role` (`Super Admin`).

### Staff notifications

- `GET /api/staff/notifications?unread=1&limit=50`
- `POST /api/staff/notifications/:id/read`
- `POST /api/staff/notifications/read-all`

### Staff chat

- `GET /api/chat/rooms`
- `POST /api/chat/rooms` with `{ user_id }` for a direct room
- `GET /api/chat/rooms/:id/messages`
- `GET /api/chat/rooms/:id/socket` — WebSocket upgrade; backed by the `CHAT_ROOM` Durable Object
- Messages are persisted in D1 `chat_messages`.

## 12. Hierarchical revenue

- `GET /api/revenue/overview?from&to&branch_id&team_lead_id&staff_id`
- `GET /api/revenue/breakdown` — alias of overview
- `GET /api/revenue/payments?from&to&branch_id&team_lead_id&staff_id&page&limit`

Scope is always derived server-side from `actual_role`, `branch_id` and `manager_id` hierarchy:

- Staff/Marketer: own registered clients only
- Team Lead: team revenue
- Branch Manager / Project Manager: own branch
- MD / Super Admin / Head Accountant / Finance Officer: national

Payments carry immutable revenue snapshots (`revenue_staff_id`, `revenue_team_lead_id`, `revenue_pm_id`, `revenue_branch_id`) written when credited.

Revenue responses include:

```json
{
  "total_kobo": 1100000000,
  "children": [],
  "children_total_kobo": 1100000000,
  "reconciles": true,
  "breadcrumb": []
}
```

## 13. Payment plans, defaulting and inspections

- `GET /api/installments` — plans in authorised scope with expected items and defaulting state.
- `GET /api/installments/:id` — one plan with expected schedule and defaulting state.
- `POST /api/installments` — create a plan (`plan_type`, `total_amount`, `installment_amount`, `start_date`, `next_due_date`, `deposit_amount`, `grace_days`, `number_of_installments`).
- `PUT /api/installments/:id` — edit a plan and regenerate expected items.
- `POST /api/installments/:id/cancel` — cancel with an audit reason.
- `GET /api/defaulting-clients?branch_id&team_lead_id&staff_id&plan_type&status&q` — hierarchy-scoped performing/defaulting register and summary.
- `GET /api/defaulting-clients/:scheduleId/follow-ups` — follow-up history.
- `POST /api/defaulting-clients/:scheduleId/follow-ups` — owner, note, next date, status (`contacted`, `promised`, `escalated`).
- `POST /api/leads/:id/inspection` — inspection date, time and property.
- `GET /api/inspections/summary` — today/next-7-day counts by branch and marketer.
- `POST /api/leads/bulk` — CSV or row-array lead import (maximum 500 rows).

Plan types: `outright`, `part_payment`, `daily`, `weekly`, `bi_monthly`, `monthly`.
Daily/weekly/bi-monthly/monthly are easy-buy plans.

## 14. Commission access and versioning

Commission endpoints require `can_access_commissions`, derived from the actual
role or `users.commission_access`:

- `GET /api/commission-options`
- `GET|POST /api/commission-plans`
- `GET|PUT /api/commission-plans/:id`
- `POST /api/commission-plans/:id/status`
- `GET /api/commissions`
- `GET /api/commissions/:id`
- `POST /api/commissions/generate`
- `POST /api/commissions/:id/submit|approve|reject|payments|adjustments`
- `GET /api/commissions/payments/:id/receipt`

`commission_plans.commissionable_mode` is one of:

- `full` — 100% of each payment (outright/part payment)
- `first_months` — only payments within the first N months
- `percentage` — only a percentage of each payment
- `capped_amount` — only up to a fixed amount per sale

Editing a plan creates a new `commission_plan_versions` row. Entries store
`plan_version_id`, `plan_version_no`, `payment_amount_kobo`, commissionable
amount and mode. A new version does not retroactively commission payments from
before the version was created.

## 15. Multi-provider payments

- `GET /api/finance/providers` — provider registry (no secrets).
- `POST /api/finance/providers` — status/environment/default provider (no secrets).
- `POST /api/webhooks/alatpay` — ALATPay adapter, verified by server re-query.
- `POST /api/webhooks/wema-alat` — Wema adapter, `X-Webhook-Secret`.
- `POST /api/webhooks/paystack` — Paystack adapter, `x-paystack-signature` HMAC-SHA512.
- Additional adapters use the generic `/api/webhooks/:provider` route.

Payments store `provider` and `provider_reference`. Webhook event ids are
provider-scoped and unique; repeated deliveries never credit twice.

## 16. Property payment plans and locked purchases

- `GET /api/properties/:id/payment-plans` — enabled plans for onboarding; managers with `property_plans_access` can request `?all=1`.
- `PUT /api/properties/:id/payment-plans` — MD, Head Accountant, Super Admin or explicitly granted users manage plans.
- Plan fields: `plan_type`, `total_price_kobo` (or `total_price`), `deposit_kobo`, `installment_kobo`, `duration_months`, `number_of_installments`, `is_enabled`.
- Client create, lead conversion and public signup accept `property_plan_id` and `plan_start_date`.
- On purchase, plan terms are copied to `clients`, `client_properties` and `payment_schedules`; later property-plan edits do not change existing clients.
- The generated schedule uses the existing plan type definitions and drives defaulting and easy-buy commission basis.

## 17. Customer care

Customer care uses dedicated endpoints and never inherits manager or commission scope.

- `GET /api/customer-care/overview`
- `GET /api/customer-care/clients?status&q&branch_id`
- `GET /api/customer-care/clients/:id`
- `POST /api/customer-care/clients/:id/clearance`
- `GET|POST /api/customer-care/clients/:id/calls`

`users.care_scope` is `branch` or `national`. Branch care is restricted to the
assigned branch; national care has no branch and sees all branches. Customer
Care accounts are created by MD/Super Admin and have no commission access.

## 18. SMS

- `GET /api/sms/overview` — controls, provider state, credit balance and counts.
- `GET /api/sms/messages?status&template_key&client_id&from&to` — scoped delivery log.
- `GET /api/sms/templates`, `PUT /api/sms/templates/:key`
- `PUT /api/sms/settings` — on/off, provider, sender ID, reminders, thresholds and statement day.
- `POST /api/sms/test`
- `POST /api/sms/refresh-balance`
- `GET|POST /api/clients/:id/sms-optout`

Payment SMS is created only after a payment is verified/credited. The unique
key `payment:<payment_id>:payment_received` prevents duplicate SMS from repeated
webhook delivery. Failed, pending or rejected payments never send SMS.
See `SMS_PROVIDER_SETUP.md`.

## 19. Lead pipeline additions

- `POST /api/leads/:id/temperature` — `Hot`, `Warm`, `Cold`; changes are logged in `lead_temperature_history`.
- `POST /api/leads/:id/follow-ups` accepts `contact_type` and `contacted_at`; the register exposes contact count and last-contacted date.
- `POST /api/leads/:id/status` with `status: "Lost"` requires `lost_reason`.
- `GET /api/leads?temperature=Hot` and the list response's `temperature_counts` support temperature filters and counts.

## 20. Client onboarding OTP

- `GET /api/clients/:id/verification` — staff read verification state.
- `POST /api/clients/:id/verification/send` — staff send a code (`channel: email|sms`).
- `POST /api/clients/:id/verification/verify` — staff verify a client code.
- `GET /api/client/verification` — logged-in client reads own state.
- `POST /api/client/verification/send` — client requests a code.
- `POST /api/client/verification/verify` — client verifies own account.

Codes are 6 digits, expire in 10 minutes, allow five attempts and are stored
hashed in `client_verification_otps`. New clients are `unverified`; successful
verification records `verified_at` and the channel. Existing clients were
backfilled as verified. Email uses the Resend adapter (`RESEND_API_KEY`,
`EMAIL_FROM`); SMS uses the existing SMS provider. See
`CLIENT_OTP_VERIFICATION.md`.

## 21. ALATPay webhooks, transaction verification and static wallets

- `POST /api/webhooks/alatpay/test` — test-mode webhook.
- `POST /api/webhooks/alatpay/live` — live-mode webhook (rejected unless `PAYMENT_MODE=live`).
- Legacy `POST /api/webhooks/alatpay` resolves to the current mode.
- Validation: `x-signature` must equal `Base64(HMAC-SHA256(raw body, webhook secret))`.
- Payload supports `{ Value: { Data: {...} } }`.
- Before credit, the transaction is re-checked at
  `/alatpaytransaction/api/v1/transactions/{transactionId}`.
- `POST /api/finance/reconciliation/alatpay` — manual reconciliation using completed ALATPay transactions.
- `GET /api/finance/clients/:id/static-wallet`
- `POST /api/finance/clients/:id/static-wallet/initiate` — transient BVN, never stored.
- `POST /api/finance/clients/:id/static-wallet/validate` — OTP validation.
- `POST /api/finance/static-wallets/backfill` — dry-run by default; non-dry-run needs per-client BVN list.

Mode and secrets:

```text
PAYMENT_MODE=test|live
ALATPAY_TEST_SECRET_KEY / ALATPAY_TEST_BUSINESS_ID / ALATPAY_TEST_WEBHOOK_SECRET
ALATPAY_LIVE_SECRET_KEY / ALATPAY_LIVE_BUSINESS_ID / ALATPAY_LIVE_WEBHOOK_SECRET
```

See `ALATPAY_INTEGRATION.md`.

## 22. Common validation rules

- Password minimum: 8 characters.
- Phone: `+0-9() -`, 7–25 characters.
- Email: standard address shape.
- Contract price: non-negative numeric, MD/BM only.
- Payment: positive NGN, unique transaction reference, existing client.
- Property price: positive numeric.
- Pagination: `page >= 1`, `1 <= limit <= 50` for properties; staff list limit up to 100.
- Uploaded files: MIME + magic-byte check + size limit.
- Public enquiries/signup/reset: audit-log rate limits.

---

## 23. Known API gaps

- No client transaction-statement PDF endpoint.
- No team-performance or customer-performance report type.
- No branch CRUD endpoint.
- No invitation/approval endpoint for staff.
- Client-initiated permanent ALATPay wallet provisioning exists, but it still depends on ALATPay credentials and the client completing the BVN OTP step.
- No automatic commission generation hook on payment credit; generation remains an explicit authorised operation.

See `KNOWN_LIMITATIONS.md`.
