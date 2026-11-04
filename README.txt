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
- dashboard.html — role-aware MD/BM/Team Lead/Marketer/Finance dashboard
- performance.html — date-filtered contract, verified, leads, branch, marketer and team analytics
- staff-management.html — staff accounts, roles, branches, activation and teams (MD/BM)
- leads.html — lead pipeline, follow-ups and conversion
- activity-centre.html — role-scoped audit/activity feed
- clients.html / properties.html / finance-dashboard.html / provider-config.html — Phases 1–5
- client-dashboard.html — existing client portal

Tests
-----
- npm run test:phase5  (62 tests)
- npm run test:phase6  (19 tests)
- npm test              (both suites, 83 tests)

Documentation
-------------
- DEVELOPMENT_PLAN.md
- PHASE6_WALKTHROUGH.md — role-by-role local testing walkthrough

Architecture and safety
-----------------------
- Bindings are unchanged: DB, FILES, CACHE, TASKS, ASSETS.
- No Supabase, Firebase or alternative primary backend.
- No remote migration, production secret, deployment, commit or push is performed by the local setup.
- ALAT/Wema remains an honest placeholder until official credentials and documentation are supplied.
- Email/WhatsApp delivery adapters remain pending; the queue records interface state only.
