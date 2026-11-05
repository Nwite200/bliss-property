# Bliss Legacy Limited — Cloudflare Deployment Guide

> **Staging:** the current staging deployment is recorded separately in `STAGING_DEPLOYMENT.md`. It uses the `bliss-property` Worker and isolated staging D1, R2, KV and Queue resources. This guide retains the production deployment sequence; do not use production bindings for staging.

**Production deployment:** `https://bliss-legacy-limited.easterntechexpo.workers.dev`

**Account:** `easterntechexpo@gmail.com` (Cloudflare account `788e3870b53ed6cb61f5c12cc04fdbc0`)

**Environment:** `production` (Worker variable), `DEMO_MODE_ENABLED=0`

---

## 1. Architecture

```text
Browser
  │
  ▼
Cloudflare Worker (bliss-legacy-limited)
  ├── Workers Static Assets  → HTML, CSS, JS, logos
  ├── D1 (DB)                → relational business data
  ├── R2 (FILES)             → images, receipts, reports, private documents
  ├── KV (CACHE)             → declared for future non-critical caching
  └── Queues (TASKS)         → notification delivery interface
```

No Supabase, Firebase, Vercel or Netlify is used.

---

## 2. Provisioned resources

| Binding | Resource | Identifier |
|---|---|---|
| `DB` | D1 `bliss-legacy-db` | `f0252b4a-20ac-4706-a269-8281c3838db5` |
| `FILES` | R2 `bliss-legacy-files` | bucket name |
| `CACHE` | KV namespace `CACHE` | `424f8f6d26624f0687508339b20b9004` |
| `TASKS` | Queue `bliss-legacy-tasks` | producer + consumer |
| `ASSETS` | Workers Static Assets | repository root, filtered by `.assetsignore` |

The D1 database was created in region **WEUR**.

---

## 3. Required secrets and variables

### Worker secrets

| Name | Required | Notes |
|---|---|---|
| `SETUP_SECRET` | Yes for first setup | Random bootstrap secret; rotate/remove after first MD |
| `EMAIL_PROVIDER` | Only when email adapter exists | Do not set until implemented |
| `WHATSAPP_PROVIDER` | Only when WhatsApp adapter exists | Do not set until implemented |

### Worker variables (`wrangler.toml`)

| Name | Current value | Notes |
|---|---|---|
| `ENVIRONMENT` | `production` | Environment label |
| `DEMO_MODE_ENABLED` | `0` | Demo data disabled |

### Provider credentials

ALAT/Wema credentials are stored in D1 `provider_configs` through the authorised provider configuration workflow. Do not commit them. Official API documentation, business credentials and signing requirements are still required.

---

## 4. Configuration file

`wrangler.toml` contains:

```toml
name = "bliss-legacy-limited"
main = "src/index.js"
compatibility_date = "2024-11-01"

[assets]
directory = "./"
binding = "ASSETS"

[[d1_databases]]
binding = "DB"
database_name = "bliss-legacy-db"
database_id = "f0252b4a-20ac-4706-a269-8281c3838db5"
migrations_dir = "migrations"

[[r2_buckets]]
binding = "FILES"
bucket_name = "bliss-legacy-files"

[[kv_namespaces]]
binding = "CACHE"
id = "424f8f6d26624f0687508339b20b9004"

[[queues.producers]]
binding = "TASKS"
queue = "bliss-legacy-tasks"

[[queues.consumers]]
queue = "bliss-legacy-tasks"
max_batch_size = 10
max_batch_timeout = 5

[triggers]
crons = ["0 6 * * *"]

[vars]
ENVIRONMENT = "production"
DEMO_MODE_ENABLED = "0"

[observability]
enabled = true
```

---

## 5. Local development

```bash
cd "/Users/a/bliss estate project "
npm install
npm run db:migrate:local
python3 seed_phase5.py
python3 seed_phase6.py
npm run dev
```

Local URL: `http://localhost:8787`

Local D1 state is under `.wrangler/state/v3/d1/`. `.wrangler/` is ignored by Git and by `.assetsignore`.

---

## 6. Tests before deployment

```bash
npm test
```

Expected current total: **134 passed, 0 failed, 0 skipped**.

Also useful:

```bash
node --check src/index.js
for f in assets/js/*.js; do node --check "$f"; done
git diff --check
```

---

## 7. Safe production deployment sequence

1. **Freeze changes and review the diff.**
2. **Back up D1** using the approved Cloudflare export/snapshot process.
3. **Verify R2 bucket is private.**
4. **Apply remote migrations:**
   ```bash
   npx wrangler d1 migrations apply bliss-legacy-db --remote
   ```
5. **Confirm migrations are complete:**
   ```bash
   npx wrangler d1 migrations list bliss-legacy-db --remote
   ```
6. **Set/rotate `SETUP_SECRET`.**
7. **Create the first MD** through `POST /api/setup` using the setup secret.
8. **Rotate `SETUP_SECRET`** immediately after setup.
9. **Seed branches/roles/categories** if a fresh database.
10. **Deploy the Worker:**
    ```bash
    npx wrangler deploy
    ```
11. **Run live smoke tests:**
    - `/api/health`
    - public homepage
    - login for each role
    - client dashboard
    - property image
    - report generation
    - private file denial
12. **Enable monitoring/alerts** before announcing the URL.
13. **Attach the custom domain/DNS** when approved.
14. **Record the deployment version ID.**

---

## 8. Rollback

### Worker rollback

Cloudflare dashboard → Workers & Pages → `bliss-legacy-limited` → Deployments → roll back to the previous version.

Or redeploy the previous Git commit after review.

### D1 rollback

D1 migrations are forward-only. Restore from the backup taken before migration. Do not attempt to “down-migrate” production without a tested plan.

### R2 rollback

R2 has no automatic version rollback. Restore affected objects from the approved backup/export.

### Queue rollback

Pause the consumer if deliveries fail repeatedly; fix and replay from stored messages where the queue retention allows.

---

## 9. Custom domain and DNS

No custom domain is attached yet. To attach one:

1. Add the domain/zone to Cloudflare.
2. Create a Worker custom domain or route in **Workers & Pages → Settings → Domains & Routes**.
3. Add the required DNS record.
4. Wait for TLS certificate issuance.
5. Test HTTPS and cookie behavior.
6. Update the public site links if the domain changes.

Do not change DNS until the business approves the domain.

---

## 10. R2 configuration

- Keep the bucket private.
- Do not enable public bucket access.
- Objects are served through the Worker:
  - `/api/files/*` for property images only.
  - `/api/client/receipts/:id/download` for client receipts.
  - `/api/finance/receipts/:id/download` for staff receipts.
  - `/api/commissions/payments/:id/receipt` for commission receipts.
  - `/api/reports/:id/download` for reports.
  - `/api/properties/:id/documents/:docId/download` for private documents.
- Consider lifecycle rules and malware scanning if documents are ever accepted from non-staff users.

---

## 11. Queue configuration

- Producer and consumer are bound to `bliss-legacy-tasks`.
- The consumer currently records delivery attempts; email/WhatsApp adapters are not implemented.
- Configure retry/dead-letter policy before enabling real provider delivery.
- Monitor backlog and repeated retries.

---

## 12. Scheduled jobs

The cron trigger is `0 6 * * *`. It currently dispatches installment reminders. It does not clean sessions/reset tokens, retry reports or run commission recalculations.

---

## 13. Monitoring and incident response

Recommended:

- Worker 5xx rate, latency and exception alerts.
- D1 error/latency alerts.
- R2 error alerts.
- Queue backlog alerts.
- Alert on repeated login failures, large refunds/reversals, manual commission adjustments and unusual report/document downloads.
- Define an on-call owner and escalation path.
- Keep a tested D1 restore runbook.

---

## 14. Current deployment notes

- The deployment is live on the `workers.dev` subdomain.
- `preview_urls` is enabled by default because it is not set in `wrangler.toml`; disable it if preview access is not wanted.
- Final redeploy excludes tests, audit documents and local setup files through `.assetsignore`. Verified: `/PHASE8_FINAL_AUDIT.md`, `/SECURITY_AUDIT.md` and `/test_phase8_suite.mjs` return 404.
- The generated live demo accounts are temporary and must be removed or rotated after testing.

---

## 15. Cloudflare Git build failure diagnosis

A Cloudflare Git-connected build failed with:

```text
KV namespace 'REPLACE_WITH_KV_NAMESPACE_ID' is not valid
```

and showed:

```text
env.CACHE (REPLACE_WITH_KV_NAMESPACE_ID)
env.ENVIRONMENT ("development")
Worker: bliss-property
```

### Root cause

The GitHub remote `main` is still at commit `34f6be8`. That commit still contains the placeholder KV namespace and `ENVIRONMENT=development`.

The local Phase 8 commit `3b9f56c` updates:

- D1 database ID to the real production database.
- KV namespace ID to the real production namespace.
- Worker name to `bliss-legacy-limited`.
- `ENVIRONMENT=production` and `DEMO_MODE_ENABLED=0`.

That commit has **not been pushed** because the current instruction prohibits a push.

### Fix

Either:

1. **Authorize pushing the local commit** `3b9f56c` (and any later reviewed commit) so the Cloudflare build reads the corrected `wrangler.toml`; or
2. Update the Cloudflare project’s build environment/configuration so it uses the correct KV namespace ID and production environment, and align the project/worker name (`bliss-property` vs `bliss-legacy-limited`).

Until one of those is done, the Git-connected Cloudflare build will continue to fail.

Do not put the KV namespace ID into a public frontend file; it belongs in `wrangler.toml` or Cloudflare project configuration.
