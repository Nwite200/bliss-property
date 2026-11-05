# Bliss Legacy Limited — Phase 6 Local Testing Walkthrough

This document is the local walkthrough for every Phase 6 staff dashboard. It replaces the need for attached screenshots because the project can be run locally and verified role by role.

**No commit, push, production deployment, remote migration, or live ALAT/Wema connection is part of this walkthrough.**

## 1. Start locally

```bash
cd "/Users/a/bliss estate project "
npm install
npm run db:migrate:local
SEED_ENV=local python3 seed_phase5.py
SEED_ENV=local python3 seed_phase6.py
npm run dev
```

Open `http://localhost:8787/login.html`.

The Phase 6 seed is idempotent and only ensures demo staff accounts, profiles, teams and team-lead attribution. It does not change verified payments, receipts, contract prices or audit history.

## 2. Demo logins

Each seed run generates a strong random password per account and prints it to
the terminal once. Record it in your password manager; only the hash is stored.
Seeds refuse to run unless `SEED_ENV` is `local` or `staging` and the database
identifier matches.

| Role | Email | Branch | Main screen |
|---|---|---|---|
| Managing Director | `md@bliss.com` | Company-wide | `dashboard.html` |
| Branch Manager | `bm.ikeja@bliss.com` | Ikeja | `dashboard.html` |
| Branch Manager | `bm.ajah@bliss.com` | Ajah | `dashboard.html` |
| Team Lead | `tl.ikeja@bliss.com` | Ikeja | `dashboard.html` |
| Team Lead | `tl.ajah@bliss.com` | Ajah | `dashboard.html` |
| Marketer | `mkt.ikeja@bliss.com` | Ikeja | `dashboard.html` |
| Marketer | `mkt.ikeja2@bliss.com` | Ikeja | `dashboard.html` |
| Marketer | `mkt.ajah@bliss.com` | Ajah | `dashboard.html` |
| Finance Officer | `finance@bliss.com` | Ikeja / company financial view | `dashboard.html`, `finance-dashboard.html` |
| Client | `ada@example.com` | Ikeja | `client-dashboard.html` |

## 3. Managing Director walkthrough

1. Sign in as `md@bliss.com`.
2. Open `dashboard.html`.
3. Confirm the company-wide KPI cards:
   - Total properties, published, reserved, sold and unavailable.
   - Total registered clients and active buyers.
   - Active staff, marketers and team leads.
   - Contract sales value.
   - Verified payments received.
   - Outstanding client balances.
   - Live leads, conversions, follow-up due count.
4. Change the date range and trend granularity. Apply the filter.
5. Confirm:
   - Sales trend chart updates.
   - Lead pipeline counts update.
   - Branch comparison includes every branch.
   - Marketer rankings are ordered by verified collections.
   - Team rankings are ordered by verified collections.
   - Recent activity shows client, property, lead, staff and team events.
6. Open `performance.html` and confirm the branch, marketer, team and lead funnel tables.
7. Open `activity-centre.html` and filter by `lead`, `staff`, `team`, `client` and `property`.
8. Open `staff-management.html` to create/edit staff, change roles or branches, activate/deactivate accounts, and manage teams.
9. Open `leads.html` to review the complete company pipeline and convert a lead.

## 4. Branch Manager walkthrough

1. Sign in as `bm.ikeja@bliss.com` or `bm.ajah@bliss.com`.
2. Open `dashboard.html`.
3. Confirm only the signed-in branch is represented:
   - Branch property inventory.
   - Branch client registry.
   - Branch contract value, verified payments and outstanding balances.
   - Branch marketers and team rankings.
   - Branch activity feed.
4. Try adding `?branch_id=2` to an Ikeja dashboard URL. The server must still return only the Ikeja scope.
5. Open `staff-management.html`:
   - The branch filter is fixed to the manager's branch.
   - Creating or editing a staff member in another branch returns 403.
   - Teams can only be created or edited inside the branch.
6. Open `leads.html`; only branch leads are visible.
7. Open `activity-centre.html`; only branch-attributed audit events are visible.

## 5. Team Lead walkthrough

1. Sign in as `tl.ikeja@bliss.com`.
2. Open `dashboard.html`.
3. Confirm:
   - Team members card lists the Team Lead and team marketers.
   - Team client portfolio contains only the team's clients.
   - Team property assignments are shown.
   - Team lead and conversion KPIs are scoped to the team.
   - Team rankings contain only the Team Lead's team.
   - Follow-ups due contains only team leads.
4. Open `leads.html`; the team's leads and follow-ups are visible.
5. Try opening an Ajah lead directly by ID. The API returns 404.
6. Open `activity-centre.html`; only the Team Lead and team-member audit events are visible.

## 6. Marketer walkthrough

1. Sign in as `mkt.ikeja@bliss.com`.
2. Open `dashboard.html`.
3. Confirm:
   - Personal profile and team.
   - Only assigned clients.
   - Only assigned properties.
   - Only personal leads and follow-ups.
   - Personal contract value, verified collections and outstanding balance.
   - Personal conversion performance.
4. Open `leads.html`:
   - Add a lead.
   - The lead is forced into the marketer's branch and assigned to the marketer.
   - Move the lead through `New Lead → Contacted → Interested → Inspection Scheduled → Negotiation`.
   - Add a follow-up note and a future follow-up date.
   - Edit the follow-up outcome.
   - Convert the lead to a client. A marketer cannot enter the contract price during conversion.
   - On `client-register.html`, the contract-price field is hidden for Marketers and Team Leads. Only MD/BM can establish or change contract prices.
5. Open `performance.html`; only the marketer's own ranking and data are shown.
6. Open `activity-centre.html`; only the marketer's own actions are visible.
7. Attempt to open another marketer's client or lead; the API returns 403/404.

## 7. Finance Officer walkthrough

1. Sign in as `finance@bliss.com`.
2. Open `dashboard.html` and confirm company-wide contract value, verified collections and outstanding balances.
3. Open `performance.html` and confirm contract value is distinct from verified cash.
4. Open `finance-dashboard.html` and confirm:
   - Verified payment totals are unchanged from Phase 5.
   - Pending and failed payments are not counted as collected revenue.
   - Demo mode remains isolated.
   - Receipts and reversals continue to work.
5. Open `activity-centre.html`; financial and operational activity is visible.
6. Confirm `staff-management.html` and `leads.html` return 403 for Finance.

## 8. Lead conversion and contract price check

1. As a Marketer, create a lead and record a follow-up.
2. Convert the lead without a contract price. Confirm the new client has no agreed purchase price.
3. As a Branch Manager or Managing Director, create/convert another lead and enter an agreed contract price.
4. Confirm the client record stores the contract price and the lead is marked `Converted` with a converted-client link.
5. Confirm the marketer cannot change the client contract price or verified payment records.

## 9. Responsive check — actual audit results

Headless Google Chrome was used with real login sessions for all five staff roles. Mobile was verified with Chrome DevTools device-metrics emulation (`390 × 844`), not only `--window-size`, because headless Chrome enforces a minimum window width that can crop a narrow screenshot.

Captured and reviewed:

| Viewport | Roles | Result |
|---|---|---|
| Desktop `1440 × 900` | MD, BM, TL, Marketer, Finance | 4-column KPI grid, sidebar visible, no horizontal page overflow. |
| Tablet `768 × 1024` | MD, BM, TL, Marketer, Finance | 2-column KPI grid, off-canvas sidebar, no horizontal page overflow. |
| Mobile `390 × 844` | MD, BM, TL, Marketer, Finance | 1-column KPI grid, off-canvas sidebar with `☰` toggle, `innerWidth=390`, `documentElement.scrollWidth=390` and `body.scrollWidth=390` for every role. |

At widths below 900px:

- The sidebar becomes an off-canvas drawer.
- The floating `☰` button opens the navigation.
- KPI cards collapse to two columns and then one column.
- Tables scroll horizontally inside their card.
- Forms collapse to a single column.

Screenshots are stored outside the repository in the local audit temp folder and are not committed. No horizontal page overflow remained after device-metrics emulation.

Two issues found during visual audit and fixed:

1. Date-only values were shifting one day in western timezones. `formatDate` now parses `YYYY-MM-DD` as a local date.
2. Finance Officer scope labels showed the officer's home branch instead of “Company-wide”; Finance hero/sidebar labels now correctly show company-wide scope.

## 10. Automated verification

Run both suites:

```bash
npm run test:phase5
npm run test:phase6
```

Expected local results:

| Suite | Passed | Failed | Skipped |
|---|---:|---:|---:|
| Phase 5 regression/security | 62 | 0 | 0 |
| Phase 6 dashboards/analytics | 21 | 0 | 0 |
| **Total** | **83** | **0** | **0** |

The Phase 6 suite covers:

- All five staff roles.
- Branch, team and marketer isolation.
- Staff creation, updates, deactivation and session invalidation.
- Team creation, lead/member assignment and branch scoping.
- Lead creation, status pipeline, follow-ups, conversion and contract-price protection.
- Dashboard calculations and date/granularity filters.
- Contract value vs verified cash.
- DEMO financial exclusion.
- Activity centre scoping.
- API security and Phase 1–5 regression.
- Responsive viewport/CSS/shell checks.

## 11. ALAT/Wema boundary

The existing Phase 5 payment architecture is unchanged. This walkthrough does not use live ALAT/Wema endpoints, credentials, virtual account numbers or webhook payloads. The provider configuration screen continues to show the approved pending-integration status until official bank onboarding is complete.

## 12. Known local-only limitations

- Email and WhatsApp delivery adapters are not active. The queue consumer records delivery interface state only.
- Wema/ALAT credentials and virtual account issuance are still external dependencies.
- Remote D1/R2/KV/Queue resources and production secrets are not configured.
- No production deployment, commit or push has been performed.
