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

### Referral fields

Client onboarding accepts:

- `alternate_phone`
- `next_of_kin_name`
- `next_of_kin_phone`
- `next_of_kin_relationship`
- `next_of_kin_address`
- `referral_code`

`/api/me` returns `referral_code` and `referral_link` for staff. `?ref=CODE` on `signup.html` pre-fills the referral code.

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
| POST | `/api/reports` | MD/FO/BM/TL/Marketer |
| GET | `/api/reports` | MD/FO/BM/TL/Marketer |
| GET | `/api/reports/:id/download` | Owner or MD/FO |

Report types: `sales`, `collections`, `outstanding`, `commission`, `branch_performance`, `marketer_performance`, `refunds`, `commission_liability`.

Marketers may generate only `commission` and `commission_liability`. Team Leads cannot generate `branch_performance`.

---

## 11. Super Admin, staff notifications and chat

### Super Admin

- `GET /api/admin/overview` — permission `admin.system`
- `GET /api/admin/roles` — permission `admin.roles`
- `PUT /api/admin/roles/:id/permissions` — permission `admin.permissions`; actual Super Admin only
- `GET /api/admin/audit` — permission `admin.audit`

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

## 13. Common validation rules

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

## 12. Known API gaps

- No staff notification inbox endpoint.
- No staff chat/message endpoints.
- No client transaction-statement PDF endpoint.
- No team-performance or customer-performance report type.
- No branch CRUD endpoint.
- No configurable permission endpoint.
- No invitation/approval endpoint for staff.
- No Wema/ALAT provisioning endpoint.

See `KNOWN_LIMITATIONS.md`.
