-- Phase 17: ELPIS referral commission automation.
--
-- Referral commission is a separate, fixed-rule ledger from the configurable
-- "commission plans" engine. Rules are seeded here and are intentionally not
-- editable through ordinary user APIs.
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS referral_commission_rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  rule_key TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL,
  structure TEXT NOT NULL, -- two_stage | flat | configuration_required
  min_months INTEGER,
  max_months INTEGER,
  stage_amount_kobo INTEGER NOT NULL DEFAULT 0,
  stage1_commission_cap_kobo INTEGER NOT NULL DEFAULT 0,
  stage2_commission_cap_kobo INTEGER NOT NULL DEFAULT 0,
  max_commission_kobo INTEGER NOT NULL DEFAULT 0,
  flat_rate_bps INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT OR IGNORE INTO referral_commission_rules
  (rule_key, label, structure, min_months, max_months, stage_amount_kobo,
   stage1_commission_cap_kobo, stage2_commission_cap_kobo, max_commission_kobo, flat_rate_bps)
VALUES
  ('long_term', 'Long-term plan (above 8 months)', 'two_stage', 9, NULL,
   6000000, 2000000, 1500000, 3500000, 0),
  ('short_term', 'Short-term plan (7 months or less)', 'flat', 0, 7,
   0, 0, 0, 0, 1000),
  ('outright', 'Outright purchase', 'flat', 0, 0,
   0, 0, 0, 0, 1000),
  ('exact_8', '8-month plan awaiting policy configuration', 'configuration_required', 8, 8,
   0, 0, 0, 0, 0);

-- One automated referral account per client. Values are recalculated from all
-- verified non-demo payments, so re-running is always safe and never duplicates.
CREATE TABLE IF NOT EXISTS referral_commission_accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id INTEGER NOT NULL UNIQUE,
  marketer_id INTEGER,
  branch_id INTEGER,
  team_id INTEGER,
  plan_type TEXT,
  plan_duration_months INTEGER,
  structure TEXT NOT NULL DEFAULT 'configuration_required',
  rule_key TEXT,
  total_paid_kobo INTEGER NOT NULL DEFAULT 0,
  qualifying_paid_kobo INTEGER NOT NULL DEFAULT 0,
  stage1_paid_kobo INTEGER NOT NULL DEFAULT 0,
  stage2_paid_kobo INTEGER NOT NULL DEFAULT 0,
  stage1_commission_kobo INTEGER NOT NULL DEFAULT 0,
  stage2_commission_kobo INTEGER NOT NULL DEFAULT 0,
  total_commission_kobo INTEGER NOT NULL DEFAULT 0,
  adjusted_kobo INTEGER NOT NULL DEFAULT 0,
  paid_kobo INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'Pending',
  flag_reason TEXT,
  last_payment_id INTEGER,
  last_calculated_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE,
  FOREIGN KEY (marketer_id) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE SET NULL,
  FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE SET NULL,
  FOREIGN KEY (last_payment_id) REFERENCES payments(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_referral_accounts_marketer ON referral_commission_accounts(marketer_id);
CREATE INDEX IF NOT EXISTS idx_referral_accounts_branch ON referral_commission_accounts(branch_id);
CREATE INDEX IF NOT EXISTS idx_referral_accounts_status ON referral_commission_accounts(status);
CREATE INDEX IF NOT EXISTS idx_referral_accounts_updated ON referral_commission_accounts(updated_at);

-- Immutable ledger of every calculation, reversal, adjustment and disbursement.
CREATE TABLE IF NOT EXISTS referral_commission_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_ref TEXT NOT NULL UNIQUE,
  source_key TEXT NOT NULL UNIQUE,
  account_id INTEGER NOT NULL,
  client_id INTEGER NOT NULL,
  payment_id INTEGER,
  marketer_id INTEGER,
  event_type TEXT NOT NULL, -- accrual | recalculation | reversal | adjustment | disbursement | flagged
  amount_kobo INTEGER NOT NULL DEFAULT 0,
  total_paid_kobo INTEGER NOT NULL DEFAULT 0,
  qualifying_paid_kobo INTEGER NOT NULL DEFAULT 0,
  net_commission_kobo INTEGER NOT NULL DEFAULT 0,
  reason TEXT,
  metadata TEXT,
  actor_user_id INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (account_id) REFERENCES referral_commission_accounts(id) ON DELETE CASCADE,
  FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE,
  FOREIGN KEY (payment_id) REFERENCES payments(id) ON DELETE SET NULL,
  FOREIGN KEY (marketer_id) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (actor_user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_referral_events_account ON referral_commission_events(account_id, created_at);
CREATE INDEX IF NOT EXISTS idx_referral_events_client ON referral_commission_events(client_id, created_at);
CREATE INDEX IF NOT EXISTS idx_referral_events_type ON referral_commission_events(event_type, created_at);

CREATE TABLE IF NOT EXISTS referral_commission_payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  payment_ref TEXT NOT NULL UNIQUE,
  idempotency_key TEXT UNIQUE,
  account_id INTEGER NOT NULL,
  amount_kobo INTEGER NOT NULL,
  method TEXT NOT NULL,
  external_reference TEXT,
  notes TEXT,
  paid_by INTEGER,
  paid_at TEXT NOT NULL DEFAULT (datetime('now')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (account_id) REFERENCES referral_commission_accounts(id) ON DELETE CASCADE,
  FOREIGN KEY (paid_by) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_referral_payments_account ON referral_commission_payments(account_id, paid_at);

CREATE TABLE IF NOT EXISTS referral_commission_adjustments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id INTEGER NOT NULL,
  adjustment_type TEXT NOT NULL, -- correction | reversal | refund | manual
  amount_kobo INTEGER NOT NULL, -- signed
  reason TEXT NOT NULL,
  source_payment_id INTEGER,
  source_key TEXT UNIQUE,
  created_by INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (account_id) REFERENCES referral_commission_accounts(id) ON DELETE CASCADE,
  FOREIGN KEY (source_payment_id) REFERENCES payments(id) ON DELETE SET NULL,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_referral_adjustments_account ON referral_commission_adjustments(account_id, created_at);
