# Bliss Legacy Limited — Known Limitations and Outstanding Work

This is an honest list of what the current implementation does **not** provide. It is not a promise that an earlier plan item is complete.

---

## 1. Organisation and permissions

1. **No Super Admin role.** The highest implemented role is Managing Director. There is no separate system-administration role or dashboard.
2. **No configurable permission matrix.** `permissions` and `role_permissions` tables exist but no route reads them. Authorization is hardcoded by role name.
3. **No staff invitation or approval workflow.** Staff accounts are created with a password and are active immediately.
4. **No employee self-application.** Marketers and other staff cannot apply for an account.
5. **No email verification** for staff or clients.
6. **No forced first-login password reset.** `users.must_reset_password` is not enforced.
7. **No staff deletion or anonymisation.** Deactivation retains all records.
8. **No branch CRUD UI.** Branches are migration-seeded.
9. **No MD-created MD.** Only the bootstrap setup endpoint creates an MD.
10. **No staff notification inbox or staff chat.** Client notifications exist; staff notifications/chat do not.

---

## 2. Public registration and onboarding

1. Public signup creates active Prospect accounts; there is no approval queue.
2. Email verification is not implemented.
3. CAPTCHA/Turnstile is not implemented.
4. Rate limiting uses D1 audit rows; production-scale edge rate limiting/WAF is still required.
5. Password-reset token delivery requires an email adapter that is not implemented.
6. Public enquiries create leads but do not send an acknowledgement email.

---

## 3. Payments and banking

1. **No live ALAT/Wema integration.** Virtual-account provisioning is read-only and returns a pending message until official API access exists.
2. No real bank payout or collection reconciliation integration.
3. Provider webhook uses a shared secret header, not official provider HMAC signing (pending official documentation).
4. No automated commission bank payouts.
5. Payment receipts are generated manually/on verification; there is no bank-grade receipt verification service.

---

## 4. Notifications and communication

1. Email delivery adapters are not implemented.
2. WhatsApp delivery adapters are not implemented.
3. Queue consumers record `pending_provider`/`skipped`; they do not send messages.
4. No staff meeting notifications.
5. No staff-to-staff chat.
6. No MD/Super Admin-to-staff chat.
7. No chat moderation, attachments, read receipts or retention policy.

---

## 5. Reports and client statements

1. No team-performance report export (dashboard ranking exists).
2. No customer-performance report or “best customer” ranking.
3. No named branch-transactions report export (the finance ledger lists transactions).
4. No client transaction-statement PDF.
5. No client outstanding-balance statement PDF.
6. No separate commission-payments report type; individual commission receipts exist.
7. PDF tables are capped for layout. CSV is the complete dataset.
8. Reports are generated synchronously; `financial_report_jobs` status/error fields are not used for queued retries.

---

## 6. Property and document management

1. No property hard delete; use status/unpublish.
2. No bulk upload.
3. No image reordering UI beyond main-image selection.
4. No malware scanning for uploaded documents.
5. No version history for documents.
6. No client-visible document download by design (internal documents are staff-only).

---

## 7. Analytics

1. Marketer rankings use original marketer/creator attribution, while client visibility and commission attribution use current assignment. This is a policy inconsistency to resolve.
2. Team rankings use team lead/member attribution.
3. No customer ranking.
4. No configurable ranking metric UI.
5. No historical snapshot/ranking trend export.

---

## 8. Security and operations

1. No per-session CSRF token (origin/fetch-metadata/SameSite protections are present).
2. No Content-Security-Policy or full security-header set.
3. No production WAF/rate-limit rules.
4. No external log drain or alerting.
5. No automated backup/restore test.
6. Provider secrets are stored in D1 plaintext; a secret-management decision is required.
7. No documented penetration test against staging.
8. Some older frontend views still interpolate API data without a shared escaping helper.
9. `CACHE` KV is provisioned but currently unused.
10. Cron does not clean expired sessions/reset tokens or retry failed notifications.

---

## 9. Client portal

1. `/api/client/property` returns the primary property only; the dashboard shows all allocations.
2. No client transaction-statement PDF.
3. No client outstanding-balance PDF.
4. Virtual account remains pending until Wema/ALAT is live.
5. No client-to-staff messaging.

---

## 10. Deployment

1. Live deployment currently uses a `workers.dev` URL; no custom domain is attached.
2. Preview URLs are enabled by default in Wrangler.
3. Production secrets beyond `SETUP_SECRET` are not configured.
4. Email/WhatsApp/ALAT credentials are not configured.
5. The live demo accounts are temporary and must be rotated/removed after testing.
6. No formal staging environment separate from the live demo deployment.

---

## 11. Documentation and testing

1. Phase 8 local tests cover the new integration/security paths; a full browser automation suite for every button/modal is not committed.
2. No visual-regression screenshots are committed as a test baseline.
3. No load/performance test against production-sized D1/R2 data.
4. No accessibility audit (axe/WCAG) has been completed.
