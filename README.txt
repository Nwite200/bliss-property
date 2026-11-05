BLISS LEGACY LIMITED — PROPERTY MANAGEMENT PLATFORM

Phases 1–6 are implemented locally on Cloudflare Workers + D1 + R2 + KV + Queues + Static Assets.

Local setup
-----------
1. npm install
2. npm run db:migrate:local
3. python3 seed_phase5.py
4. python3 seed_phase6.py
5. npm run dev
6. Open http://localhost:8787/login.html

Demo staff logins use password123:
- md@bliss.com — Managing Director
- bm.ikeja@bliss.com / bm.ajah@bliss.com — Branch Managers
- tl.ikeja@bliss.com / tl.ajah@bliss.com — Team Leads
- mkt.ikeja@bliss.com / mkt.ikeja2@bliss.com / mkt.ajah@bliss.com — Marketers
- finance@bliss.com — Finance Officer
- ada@example.com — Client portal

Main screens
------------
- signup.html — public client self-registration with official logo and auto-login
- dashboard.html — role-aware MD/BM/Team Lead/Marketer/Finance dashboard with commission summaries
- performance.html — date/category-filtered contract, verified, commission, branch, marketer and team analytics
- commissions.html — commission plans, generation, approvals, payments, adjustments and receipts
- reports.html — role-scoped CSV/PDF financial reports stored privately in R2
- staff-management.html — staff accounts, roles, branches, activation and teams (MD/BM)
- leads.html — lead pipeline, follow-ups and conversion
- activity-centre.html — role-scoped audit/activity feed
- clients.html / properties.html / finance-dashboard.html / provider-config.html — Phases 1–5
- client-dashboard.html — client portal with multi-property allocations, verified payments, remaining balance and per-property progress

Tests
-----
- npm run test:phase5  (62 tests)
- npm run test:phase6  (21 tests)
- npm run test:phase7  (26 tests)
- npm run test:phase8  (19 tests)
- npm test              (all suites, 128 tests)

Documentation
-------------
- DEVELOPMENT_PLAN.md
- PHASE6_WALKTHROUGH.md — role-by-role local testing walkthrough
- PHASE7_WALKTHROUGH.md — commission and financial-report walkthrough
- PHASE8_FINAL_AUDIT.md — Phase 8 integration/security audit
- PRODUCTION_READINESS_CHECKLIST.md
- CLOUDFLARE_DEPLOYMENT_GUIDE.md
- API_DOCUMENTATION.md
- SECURITY_AUDIT.md
- KNOWN_LIMITATIONS.md
- BLISS_LEGACY_OPERATIONAL_WORKFLOW.md
- ROLE_AND_ONBOARDING_AUDIT.md

Architecture and safety
-----------------------
- Bindings: DB, FILES, CACHE, TASKS, ASSETS.
- No Supabase, Firebase or alternative primary backend.
- Staging deployment: https://bliss-property.easterntechexpo.workers.dev
- Production deployment: https://bliss-legacy-limited.easterntechexpo.workers.dev
- ALAT/Wema remains an honest placeholder until official credentials and documentation are supplied.
- Email/WhatsApp delivery adapters remain pending; the queue records interface state only.
- There is no separate Super Admin role; the Managing Director is the highest implemented role.
