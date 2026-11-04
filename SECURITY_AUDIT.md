# Bliss Legacy Limited — Phase 8 Security Audit

**Scope:** local Cloudflare Worker, D1 schema, R2 object handling, browser frontend and role model.

**Result:** no unresolved critical or high-severity defect was found in the implemented local system. Several medium issues were fixed during Phase 8. Remaining items are documented as production/operational work, not silently claimed as complete.

---

## 1. Authentication and sessions

### Verified / fixed

| Control | Status |
|---|---|
| Password hashing | PBKDF2-HMAC-SHA-256, 100,000 iterations, random 16-byte salt |
| Password comparison | Derived hash equality check; plaintext is never stored |
| Login identifiers | Email, client reference or phone; normalised input |
| Login throttling | 10 failures per identifier per 15 minutes through audit log |
| Session ID | Cryptographically random UUID |
| Session lifetime | 8 hours; expired sessions deleted when presented |
| Cookie flags | `HttpOnly; Secure; SameSite=Lax` |
| Logout | Session row deleted and cookie expired |
| Password change | All other sessions revoked |
| Password reset | Single-use token with one-hour expiry; all sessions revoked |
| Session fixation | Existing browser session is deleted before a new login session is issued |
| Deactivated user | Session lookup rejects inactive users; deactivation deletes sessions |

### Outstanding

- Password-reset token delivery depends on an external email provider. The interface currently generates the token but does not send an email.
- Login throttling is identifier-based, not IP-based. A production edge rate limit or WAF rule is recommended.
- `users.must_reset_password` exists in schema but is not enforced. This is not used by the current UI.

---

## 2. Authorization model

Tested directly through API requests:

| Role | Scope verified |
|---|---|
| Managing Director | Company-wide management and finance |
| Branch Manager | Own branch; staff and report scopes restricted |
| Team Lead | Team-scoped clients/leads/commissions; no staff management |
| Marketer | Own/current-assignment clients, leads and commissions only |
| Finance Officer | Company-wide finance and commissions; no staff/lead management |
| Client | Own profile, properties, payments, receipts and notifications only |

Phase 7 reassignment rules remain intact:

- The previous marketer loses client/property/payment visibility when the primary assignment changes.
- A previous cross-branch Branch Manager loses visibility when the client’s branch changes.
- The current relationship manager and current branch retain access.

Property documents and unpublished property images are now explicitly branch-scoped for Branch Managers. Clients cannot download internal documents.

### Outstanding

- The `permissions` / `role_permissions` tables are present but authorization is implemented with role-name checks in the worker. The unused tables should either be removed or wired into a future permission engine; they are not a hidden bypass because no route reads them.
- Team Lead visibility still uses the existing team/created-by attribution model. It was not broadened or narrowed in Phase 8 because that would change a Phase 6 business rule without authorization.

---

## 3. CSRF, origin and request validation

### Fixed / verified

- All browser state-changing routes call `csrfOk` except `/api/setup` (secret header) and the webhook (shared secret header).
- `Origin`/`Host` comparison remains.
- `Sec-Fetch-Site` is now rejected when it is not `same-origin`, `same-site` or `none`.
- Malformed JSON now returns JSON `400` instead of surfacing an unhandled exception.
- Existing tests confirm cross-site Origin requests receive `403`.

### Outstanding

- There is no per-session CSRF token. `SameSite=Lax`, origin checks and fetch-metadata checks provide defence in depth, but a synchroniser token is a future hardening option.
- Webhook authentication uses a static shared secret header, not HMAC signing with timestamp/replay protection beyond the existing timestamp window. Official Wema/ALAT signing requirements must be implemented from provider documentation when available.

---

## 4. SQL injection and query safety

- User-controlled values are passed through D1 `.bind(...)` parameters.
- Dynamic SQL fragments are limited to server-controlled field/column lists and validated enums.
- New report filters were added as bound parameters.
- The new public enquiry route and document routes use bound values.
- No string concatenation of untrusted request values into SQL was introduced in Phase 8.

### Outstanding

- A formal query-plan/performance review against production-sized data has not been performed. Existing indexes cover the main foreign keys and common filters.

---

## 5. XSS and output escaping

### Fixed

- Client detail notes, assignment history, status history and property metadata are escaped.
- Client dashboard property titles, locations, categories, references, notices and notifications are escaped.
- Property detail page document filenames are escaped.
- Finance transaction verification actions were converted from interpolated inline JavaScript to data attributes plus event listeners.

### Outstanding

- Some older pages still build HTML from API data without a shared escaping helper. The highest-risk client/staff financial views were repaired, but a full frontend templating review is still advisable before production.
- No Content-Security-Policy header is set. Cloudflare Workers/Pages headers or `_headers` could add CSP, `Referrer-Policy` and `Permissions-Policy`.

---

## 6. File and R2 security

### Fixed / verified

- `/api/files/*` only serves keys registered as property images.
- Receipts, reports and property documents are rejected by `/api/files/*`.
- Property documents use the private `property-documents/` prefix and are served only through an authenticated, role-checked download route.
- Documents use `Content-Disposition: attachment` and `Cache-Control: private, no-store`.
- Image and document uploads verify file signatures:
  - JPEG: `FF D8 FF`
  - PNG: `89 50 4E 47`
  - GIF: `GIF8`
  - PDF: `%PDF`
  - WebP: RIFF/WEBP
- Size limits: images 5MB; documents 10MB.
- Filenames are sanitised.
- Unpublished images require staff authorization; cross-branch and Client access are denied.
- Published images receive public caching; unpublished images receive `private, no-store`.
- Receipt and commission-receipt R2 keys are prefix-checked before retrieval.

### Outstanding

- Signed URLs are not used; files are streamed through the Worker after authorization. This is acceptable but should be monitored for large files and Worker CPU/bandwidth limits.
- Malware scanning of uploaded documents is not implemented. If documents are accepted from the public in future, a scanning service should be added. Current document upload is staff-only.

---

## 7. Public signup and enquiry abuse controls

### Implemented locally

- Public signup still creates only Client accounts.
- Self-assigned role, branch, marketer, team lead, contract price and status are ignored.
- Duplicate email and duplicate phone/client record checks remain.
- Registration attempts are rate-limited by IP and email through audit records.
- Public enquiries create leads only, with no staff assignment and no price.
- Enquiries are IP-rate-limited.
- Password reset requests are IP-rate-limited.

### Outstanding

- Email verification is not implemented.
- CAPTCHA/Turnstile is not implemented; Cloudflare Turnstile is the recommended production option.
- The current rate limiting uses D1 audit rows, which is adequate for local validation but should be supplemented by Cloudflare WAF/rate-limiting rules or KV counters at production scale.
- Public enquiry forms do not yet send an acknowledgement email.

---

## 8. Sensitive information exposure

- Provider secrets are stored in D1 `provider_configs` and returned only to authorised MD/Finance calls; they are not embedded in frontend assets.
- `.dev.vars` remains ignored and untracked.
- No production secrets are present in the repository.
- Error responses no longer expose stack traces.
- Demo data remains labelled and excluded from live financial reports.

### Outstanding

- Provider webhook secrets are stored as plaintext D1 values. A production secret manager or encryption-at-rest strategy should be selected by the business.
- The setup endpoint accepts a bootstrap secret; production must rotate/remove it after initialization.

---

## 9. Logging and monitoring

- Login success/failure, client changes, payment verification, reversals, commission workflow, report generation and document operations write audit records.
- Queue delivery attempts are recorded in `notification_deliveries`.
- Webhook events are stored in `webhook_events`.

### Outstanding

- No external log drain or alerting is configured.
- No anomaly alert exists for repeated login failures, large refunds, commission adjustments, report downloads or document downloads.
- Cron only dispatches payment reminders. It does not clean expired sessions/reset tokens or retry failed notifications.

---

## 10. Summary

**Fixed in Phase 8:** session fixation, CSRF fetch-metadata gap, unhandled JSON errors, public enquiry persistence, public enquiry/signup/reset rate limits, property document lifecycle, magic-byte validation, private document R2 isolation, unpublished image cache leakage, receipt key-prefix validation, several frontend XSS vectors, broken auth guards, lead deep links and mobile navigation.

**Still required before production:** provider email/WhatsApp adapters, Wema/ALAT official signing/integration, email verification/Turnstile/edge rate limiting, CSP/security headers, monitoring/alerting, secret-management decision, backup/restore validation and a full penetration test against the deployed staging environment.
