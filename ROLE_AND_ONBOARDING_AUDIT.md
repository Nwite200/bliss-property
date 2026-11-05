# Bliss Legacy Limited — Role, Onboarding and Administration Audit

**Method:** direct inspection of `migrations/*.sql`, `src/index.js`, all HTML pages and `assets/js/*`. Local D1 role rows and staff accounts were queried. No feature is marked implemented because an earlier plan mentioned it.

**Key finding:** there is **no Super Admin role** in the current implementation. The highest implemented role is **Managing Director**. The `permissions` and `role_permissions` tables exist but are not read by any API route; authorization is hardcoded by role name.

---

## 1. Actual role structure

| # | Role | Exists? | Separate? | Created by | Branch | Dashboard |
|---|---|---|---|---|---|---|
| 1 | Super Admin | **NO** | — | — | — | None |
| 2 | Managing Director | Yes | Yes | First account only through `POST /api/setup`; no later API can create another MD | Company-wide (`branch_id` null) | Role-aware `/dashboard.html` |
| 3 | Branch Manager | Yes | Yes | MD through `POST /api/staff`; no BM can create another BM | One branch | Branch-scoped dashboard |
| 4 | Team Lead | Yes | Yes | MD or own-branch BM through `POST /api/staff` | One branch; optional team membership/lead | Team-scoped dashboard |
| 5 | Marketer | Yes | Yes | MD or own-branch BM through `POST /api/staff` | One branch; optional team | Personal dashboard |
| 6 | Finance Officer | Yes | Yes | MD or own-branch BM through `POST /api/staff` | A branch field is stored, but finance access is company-wide | Finance dashboard |
| 7 | Client | Yes | Yes | Public `POST /api/signup`; staff `POST /api/clients` creates a client record without a portal login | Assigned branch | Client portal |

Source: `migrations/0001_auth_org.sql:98-103`, role checks in `src/index.js`, `assets/js/staff-shell.js`.

### 1.1 Super Admin vs Managing Director

- There is no Super Admin table row, role enum value, dashboard, permission bypass or seed account.
- `/api/setup` creates the first **Managing Director**, not a Super Admin.
- The MD has company-wide business access and can manage staff, branches, properties, clients, commissions and reports.
- The MD cannot create another MD through `/api/staff` or `/api/users`.
- System configuration is split across MD/Finance pages (`provider-config.html`, `finance-dashboard.html`) rather than a separate Super Admin console.
- Configurable role permissions are **not implemented**.

---

## 2. Account creation and approval matrix

| Account type | Who creates it today | Who approves it | Activation | Can create other accounts |
|---|---|---|---|---|
| First Managing Director | Bootstrap caller with `X-Setup-Secret` at `POST /api/setup` | None; bootstrap secret is the only gate | Immediate | Yes, after login |
| Additional Managing Director | **No route** | — | — | — |
| Branch Manager | MD via staff-management UI or `POST /api/staff` | None | Immediate; no invitation | Can create TL, Marketer, Finance in own branch |
| Team Lead | MD or own-branch BM | None | Immediate | No |
| Marketer | MD or own-branch BM | None | Immediate | No |
| Finance Officer | MD or own-branch BM | None | Immediate | No |
| Client portal user | Public `POST /api/signup` | None | Immediate; status `Prospect` | No |
| Client record (no login) | MD/BM/TL/Marketer through `POST /api/clients` | None | Immediate; status set by creator | No |

### 2.1 Staff onboarding steps as implemented

1. MD/BM signs in at `login.html`.
2. Opens `staff-management.html`.
3. Clicks **Create staff account**.
4. Enters email, temporary password, full name, role, branch, phone, job title, date joined, optional team and notes.
5. Submits `POST /api/staff`.
6. The account is inserted directly into `users` with `is_active=1`.
7. A `staff_profiles` row is written.
8. Optional team membership is inserted.
9. An audit record `staff.create` is written.
10. The new staff member signs in with the password supplied out-of-band.

There is **no invitation email**, **no pending state**, **no staff approval queue**, **no email verification** and **no forced first-login password reset** (`must_reset_password` is unused).

### 2.2 Direct answers

- **Who creates a Branch Manager today?** Only a Managing Director, through `POST /api/staff` or the staff-management page.
- **Can a Branch Manager create Marketer accounts?** Yes, in their own branch.
- **Can a Branch Manager create Team Leads?** Yes, in their own branch.
- **Can a Marketer register independently?** No. There is no public staff application route.
- **Can a prospective employee apply for an account?** No.
- **Does anyone approve these applications?** There are no applications and no approval workflow. Accounts are active immediately.
- **Can the MD assign a staff member to another branch?** Yes, through `PUT /api/staff/:id`; the MD may select another branch.
- **Can a Super Admin override role and branch assignments?** There is no Super Admin. The MD is the highest override role.
- **What happens when an employee leaves?** MD/BM uses `POST /api/staff/:id/status` with `active:false`. Sessions are deleted, the account is marked inactive and records are retained. There is no delete/anonymisation workflow. The last active MD cannot be deactivated.

### 2.3 Client onboarding steps as implemented

1. Client opens `signup.html`.
2. Enters full name, email, phone, optional property and password.
3. `POST /api/signup` checks duplicate email/phone and rate limits attempts.
4. A Client user and a Prospect client record are created in Head Office.
5. An assignment to the first active MD is recorded.
6. A welcome notification and session are created.
7. Staff later assign branch, marketer and team lead through `POST /api/clients/:id/assign` (UI exists on client detail only for status/notes, not assignment controls).

Clients cannot choose role, branch, marketer, team lead, contract price or status.

---

## 3. Permission configuration

### Current state

- Roles are hardcoded strings in `src/index.js`.
- Access is enforced in Worker APIs, not only by hiding menus.
- `permissions` and `role_permissions` exist in migration `0001`, but no route reads them.
- There is no permission-matrix UI.
- No Super Admin can toggle view/create/edit/delete/approve/reject/assign/export/download/configure per role.

### Required design if configurable permissions are adopted

A configurable matrix must be a **ceiling**, not a grant. Example mandatory boundaries:

- Marketer personal records only; never company-wide finance.
- BM branch only; never another branch.
- Finance no staff role administration.
- Client own records only.
- Only MD/authorised finance can verify/refund/adjust payments.
- Only MD/BM can establish contract prices.
- Only MD/authorised finance can approve/pay commissions.

Enabling a menu item must never bypass these API constraints.

**Status: NOT IMPLEMENTED.**

---

## 4. Dashboard feature audit

### 4.1 Super Admin dashboard

**Status: NOT IMPLEMENTED.** No page, route or role exists.

### 4.2 Managing Director dashboard

Implemented and verified:

- Company-wide KPIs: properties, reserved/sold, clients, active staff, contract value, verified payments, outstanding balances, leads, conversion, published listings.
- Period KPIs and trend chart.
- Lead pipeline and due follow-ups.
- Branch comparison table.
- Marketer rankings.
- Team rankings.
- Commission summary and recent entries.
- Recent clients, properties and audit activity.
- Company-wide finance ledger and reports.
- Staff management, team management, branch assignment, activation/deactivation.
- Property management, images, private documents.
- Client management, assignments, contract prices, notes.
- Commission plans, generation, approvals, payments and adjustments.
- Financial reports and exports.

Missing or partial:

- No separate system-configuration console.
- No configurable permission matrix.
- No staff approval/invitation workflow.
- No staff-to-staff chat.
- No staff notification API/UI.
- No customer-performance ranking.
- No team-performance export type.
- No MD-created MD.

### 4.3 Branch Manager dashboard

Implemented and verified:

- Branch KPIs, branch sales, verified collections, outstanding balances.
- Branch property and client lists.
- Branch marketer rankings (by verified collections, then contract value).
- Branch team rankings (by verified collections, then contract value).
- Branch commission overview.
- Branch-scoped reports and exports.
- Branch staff management (TL, Marketer, Finance only).
- Branch team management.
- Branch property creation/editing and private documents.
- Client status, notes, assignment within branch.

Partial/missing:

- Pending staff/client approval queue: **not implemented** (no approval workflow exists).
- Best-performing customers: **not implemented**.
- Branch transaction report as a named export: **not implemented**; collections/outstanding reports cover most data.
- Cannot create another Branch Manager.
- Cannot move staff/clients to another branch.
- Staff notifications/chat: **not implemented**.

### 4.4 Team Lead dashboard

Implemented and verified:

- Team clients, assigned properties, contract value, verified collections, outstanding.
- Team leads/open leads, conversion rate, follow-ups due.
- Team member list.
- Team client/property lists.
- Team commission summary.
- Team-scoped reports (excluding branch-performance report).
- Lead creation/management and conversion.

Partial/missing:

- No dedicated team-performance PDF/CSV report type; team rankings appear on dashboard only.
- No team staff management (by design).
- No staff notifications/chat.

### 4.5 Marketer dashboard

Implemented and verified:

- Personal clients and assigned properties.
- Personal contract value, verified collections, outstanding.
- Personal leads, conversions, conversion rate and follow-ups.
- Personal commission summary/history.
- Personal client detail, property/payment progress.
- Personal commission CSV/PDF exports only.
- Lead creation/management.

Partial/missing:

- No personal sales report export (only commission/commission-liability).
- No personal customer transaction statement export.
- No staff notifications/chat.
- Marketer rankings use original attribution, not the current relationship-manager assignment. This is a business-rule inconsistency to review.

### 4.6 Finance Officer dashboard

Implemented and verified:

- Company-wide contract value, verified collections, outstanding balances.
- Company-wide transaction ledger.
- Manual payment recording, verification, refunds, reversals, failures.
- Installment schedules.
- Provider configuration and reconciliation.
- Commission plans, approvals, payments, adjustments, receipts.
- Financial reports and CSV/PDF exports.
- No staff/lead management.

Partial/missing:

- No staff notifications/chat.
- No bank payout integration.
- No customer self-service statement export.

### 4.7 Client dashboard

Implemented and verified:

- Own properties and multi-property allocations.
- Contract price, verified paid amount, remaining balance and progress.
- Payment history.
- Receipt list and PDF download.
- Installment schedule view.
- Virtual-account pending/active status.
- Notifications, including payment and account messages.
- Profile editing and password change.
- Own data only; cross-client API access returns 403.

Partial/missing:

- No downloadable full transaction statement PDF.
- No downloadable outstanding-balance statement.
- Virtual account provisioning depends on Wema/ALAT.
- No client-to-staff chat.

---

## 5. Notifications and internal communication

### Implemented

- Client notifications table and endpoints:
  - `GET /api/client/notifications`
  - `POST /api/client/notifications/:id/read`
  - `POST /api/client/notifications/read-all`
- Notifications are generated for client welcome, payment verification, reversal/refund, installment changes, commission events and lead conversion.
- Client dashboard shows recent notifications and unread count.

### Not implemented

- No staff notification inbox endpoint or page. Staff notifications are written to `notifications` with `user_id`, but no staff API reads them.
- No meeting notifications.
- No staff-to-staff chat or direct messages.
- No chat tables, routes, UI, moderation, attachments or read receipts.
- Email/WhatsApp delivery adapters are placeholders only.

**Recommendation:** treat staff notifications and internal chat as a separate Phase 9 module after the owner approves the policy (who can message whom, retention, moderation, attachments and notification channels).

---

## 6. Reports and exports

| Report / export | Status | Scope |
|---|---|---|
| Sales CSV/PDF | IMPLEMENTED | MD/FO/BM/TL/Marketer (role-scoped) |
| Collections CSV/PDF | IMPLEMENTED | Role-scoped |
| Outstanding CSV/PDF | IMPLEMENTED | Role-scoped |
| Branch performance CSV/PDF | IMPLEMENTED | MD/FO/BM; TL blocked |
| Marketer performance CSV/PDF | IMPLEMENTED | MD/FO/BM/TL |
| Team performance report | **NOT IMPLEMENTED** as export; dashboard team ranking exists | — |
| Customer performance report | **NOT IMPLEMENTED** | — |
| Commission CSV/PDF | IMPLEMENTED | Role-scoped; Marketer own only |
| Commission liability CSV/PDF | IMPLEMENTED | Role-scoped |
| Commission payments statement | **PARTIAL** — commission payment receipt PDFs exist; no separate report type | — |
| Refunds/reversals CSV/PDF | IMPLEMENTED | Role-scoped |
| Branch transactions report | **PARTIAL** — transaction list in finance dashboard; no named export | — |
| Customer transaction statement download | **NOT IMPLEMENTED** | Client sees payment history but cannot download a statement |
| Individual payment receipt | IMPLEMENTED | Client and authorised staff |
| Outstanding balance statement download | **NOT IMPLEMENTED** | Client sees balance only |

PDF reports include the official logo, report reference, generation date, creator, filters and summary. CSV is the complete filtered dataset. The PDF table is capped for layout; CSV is complete. Report files are stored under the private `reports/` R2 prefix and ownership-checked.

---

## 7. Performance metrics actually used

| Metric | Calculation | Notes |
|---|---|---|
| Contract sales value | Sum of `clients.agreed_purchase_price` in scope | Contract value, not cash |
| Verified collections | Sum of `payments.amount_kobo` where `status='verified'`, `is_demo=0`, `currency='NGN'` | Actual verified cash |
| Outstanding | `max(0, contract - verified)` | Refunds/reversals reduce verified |
| Marketer ranking | Sort by verified collections desc, then contract value | Uses `original_marketer_id` or `created_by` |
| Team ranking | Sort by verified collections desc, then contract value | Uses team lead or team members |
| Lead conversion | `converted leads / total leads × 100`, one decimal | Scope-specific |
| Branch comparison | Client/contract/verified/outstanding by branch | Category filter supported |
| Customer performance ranking | **NOT IMPLEMENTED** | — |

### Important business-rule note

Client visibility and commission attribution use the **current** relationship-manager assignment after Phase 7. Marketer performance rankings still use **original** marketer/creator attribution. This means a reassigned client can disappear from the old marketer's client list while still contributing to the old marketer's ranking. The owner should decide which rule is correct before production.

---

## 8. Local test accounts

Local accounts already exist and were not duplicated. Seed scripts now generate a fresh random password per account at run time and print it once; only the hash is stored.

See the final response for the local URLs and credentials. Do not reuse these passwords in production.

| Role | Local account |
|---|---|
| Managing Director | `md@bliss.com` |
| Branch Manager (Ikeja) | `bm.ikeja@bliss.com` |
| Branch Manager (Ajah) | `bm.ajah@bliss.com` |
| Team Lead (Ikeja) | `tl.ikeja@bliss.com` |
| Team Lead (Ajah) | `tl.ajah@bliss.com` |
| Marketer | `mkt.ikeja@bliss.com`, `mkt.ikeja2@bliss.com`, `mkt.ajah@bliss.com` |
| Finance Officer | `finance@bliss.com` |
| Client | `ada@example.com` |

**Super Admin:** no account exists because the role does not exist.

---

## 9. Prioritised recommendations

1. **Decide the Super Admin policy.** Create a true system role only if it will be separate from MD; otherwise rename the expectation to “MD system administration”.
2. **Add staff onboarding states.** Invitation, pending approval, approved, active, suspended. Add approvals, email verification and forced first-login reset.
3. **Build a permission matrix as a ceiling.** Keep mandatory API boundaries.
4. **Add staff notifications and internal chat.** Separate from client notifications; define retention and moderation.
5. **Add team-performance and customer-performance reports.**
6. **Add client transaction and outstanding-balance statement PDFs.**
7. **Resolve marketer ranking attribution.** Current assignment vs original attribution must be an explicit policy.
8. **Add customer-ranking metric configuration** if “best customer” is required.
9. **Add email/WhatsApp adapters** and verify provider credentials.
10. **Replace demo passwords, provision production secrets and run a staging penetration test.**
