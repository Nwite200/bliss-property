# Bliss Legacy Limited — Staging Deployment Record

**Worker:** `bliss-property`

**Staging URL:** `https://bliss-property.easterntechexpo.workers.dev`

**Branch:** `staging` (see the final response for the exact tip)

**Environment:** `staging`

**Demo mode:** disabled (`DEMO_MODE_ENABLED=0`); all staging records are explicitly labelled `STAGING TEST` and are fictional.

---

## 1. Staging Cloudflare resources

| Binding | Resource | Identifier |
|---|---|---|
| `DB` | D1 `bliss-legacy-staging-db` | `294d118f-96c1-4878-ad56-a33d0b866958` |
| `FILES` | R2 `bliss-legacy-staging-files` | bucket name |
| `CACHE` | KV `CACHE_STAGING` | `c8968754a05a4b38b29320e79b8ee3ba` |
| `TASKS` | Queue `bliss-legacy-staging-tasks` | producer + consumer |
| `ASSETS` | Workers Static Assets | repository root filtered by `.assetsignore` |

These are separate from the production resources. Staging is not connected to `bliss-legacy-db`, `bliss-legacy-files`, `CACHE` production namespace or `bliss-legacy-tasks`.

---

## 2. Migration status

All nine migrations were applied to `bliss-legacy-staging-db` only:

- `0001_auth_org.sql`
- `0002_properties.sql`
- `0003_clients.sql`
- `0004_payments.sql`
- `0005_phase5_enhancements.sql`
- `0006_phase5_completion.sql`
- `0007_phase6_staff_dashboards.sql`
- `0008_phase7_commissions_reports.sql`
- `0009_client_properties.sql`

`wrangler d1 migrations list bliss-legacy-staging-db --remote` reports no pending migrations.

---

## 3. Tests

| Suite | Passed | Failed | Skipped |
|---|---:|---:|---:|
| Phase 5 | 62 | 0 | 0 |
| Phase 6 | 21 | 0 | 0 |
| Phase 7 | 26 | 0 | 0 |
| Phase 8 | 19 | 0 | 0 |
| **Total** | **128** | **0** | **0** |

Also passed: `node --check` for the Worker, all external JS and all test suites; inline HTML script checks; `git diff --check`.

---

## 4. Live staging verification

Verified against `https://bliss-property.easterntechexpo.workers.dev`:

- `/api/health` returns 200.
- Public homepage returns 200 and renders live D1 staging property cards.
- `GET /api/properties` returns the two staging properties.
- Public published image returns 200.
- Private property document returns 401 anonymously and 200 for the Branch Manager; it is 404 through `/api/files/*`.
- All six implemented roles log in and load their dashboards.
- Marketer is denied company finance (`403`).
- Finance is denied lead management (`403`).
- Client is denied staff APIs (`403`) and sees own property/payment/notification data.
- Public enquiry creates a real staging lead.
- Client registration creates a staging client.
- Assignment and contract price update succeed.
- Manual payment verification succeeds.
- Commission generation succeeds.
- Sales, collections, outstanding and commission CSV reports generate.
- Commission PDF report generates and begins with `%PDF-`.
- CSV and PDF downloads return 200.
- Desktop 1440×900 and mobile 390×844 renders for MD, BM, TL, Marketer, Finance and Client show no document-level horizontal overflow.

---

## 5. Clear fictional staging data

| Record | Value |
|---|---|
| MD | `staging.md@blisslegacy.test` |
| Branch Manager | `staging.bm@blisslegacy.test` |
| Team Lead | `staging.tl@blisslegacy.test` |
| Marketer | `staging.marketer@blisslegacy.test` |
| Finance | `staging.finance@blisslegacy.test` |
| Client | `staging.client@blisslegacy.test` |
| Property 1 | `STAGING TEST — Ikeja Garden Estate` |
| Property 2 | `STAGING TEST — Riverside Plots` |
| Payment reference | `STG-DEMO-PAY-001` |
| Public enquiry | `STAGING TEST Enquiry` |

Passwords are supplied only in the secure handover/final response and are not stored in this repository.

---

## 6. Workers Builds status

The existing `bliss-property` Worker was deployed manually with Wrangler using the staging configuration.

Cloudflare Workers Builds configuration could **not** be changed from this environment because the authenticated Wrangler OAuth token lacks the required `workers_builds:write` scope. The Builds API returned:

```text
403 Authentication error
```

Required owner action in the Cloudflare dashboard:

1. Open **Workers & Pages → bliss-property → Settings → Builds**.
2. Connect/confirm GitHub repository `Nwite200/bliss-property`.
3. Set the production/deployment branch to `staging`.
4. Set build command to the project’s normal install/build command (there is no separate build step required for this static-assets Worker).
5. Set deploy command to `npx wrangler deploy`.
6. Confirm the build uses this branch’s `wrangler.toml` staging bindings.
7. Do not point it at the production branch or production resources.

Until that dashboard step is completed, Git pushes will not automatically trigger a staging deployment, even though the Worker itself is live from the manual Wrangler deployment.

---

## 7. PWA and motion

- `manifest.json` is served with HTTP 200 and Chrome reports no installability errors.
- Service worker `sw.js` registers at scope `/` with cache `bliss-pwa-v5-static`.
- Install UI supports Android `beforeinstallprompt` and iOS Safari **Add to Home Screen** instructions.
- Offline fallback: `/offline`.
- Logo intro uses `assets/js/intro-config.js` with `INTRO_STYLE='hype'` by default and a `classic` variant available by changing one constant.
- Full hype sequence is 3.0 s; short internal/Back-Forward hype is 1.0 s; classic is 2.7 s full and 1.35 s short.
- Intro replays on page loads, refresh, direct URLs, Back/Forward and dashboard tab view changes; non-navigation clicks do not replay it.
- PWA icons are generated from the official `assets/images/bliss-legacy-logo.png` file.
- No ODATANO asset or brand string exists in the repository. The intro therefore uses the actual Bliss Legacy logo; `LOGO_SRC` in `assets/js/intro-config.js` is the single swap point if a real ODATANO file is supplied.

## 8. Deployment version

Current staging deployment version ID: `6989e126-06f9-4442-8549-57fedcb49530`

---

## 8. Safety notes

- `SETUP_SECRET` is set on the staging Worker; rotate or delete it after initial account creation.
- Staging demo passwords must be rotated after the demonstration.
- No production D1/R2/KV/Queue resource was modified by the staging deployment.
- No production migration was applied.
- No production data was used.
