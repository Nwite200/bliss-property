-- Phase 7: commission plans, calculations, approvals, payments, adjustments and financial reports
PRAGMA foreign_keys = ON;

-- 1. Sales type used by commission plan rules. Existing clients default to New Sale.
ALTER TABLE clients ADD COLUMN sale_type TEXT NOT NULL DEFAULT 'New Sale';

-- 2. Commission plan header
CREATE TABLE IF NOT EXISTS commission_plans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  description TEXT,
  calculation_basis TEXT NOT NULL, -- contract_value | verified_collections | fixed
  effective_from TEXT,
  effective_to TEXT,
  approval_required INTEGER NOT NULL DEFAULT 1,
  separation_of_duties INTEGER NOT NULL DEFAULT 1,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_by INTEGER NOT NULL,
  updated_by INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (created_by) REFERENCES users(id),
  FOREIGN KEY (updated_by) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_commission_plans_active ON commission_plans(is_active);
CREATE INDEX IF NOT EXISTS idx_commission_plans_basis ON commission_plans(calculation_basis);

-- 3. Role/eligibility rules for each plan. Multiple rules allow marketer, team lead
-- and branch manager arrangements under one governed plan.
CREATE TABLE IF NOT EXISTS commission_plan_rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  plan_id INTEGER NOT NULL,
  role_name TEXT NOT NULL, -- Marketer | Team Lead | Branch Manager
  rate_bps INTEGER NOT NULL DEFAULT 0, -- 10000 = 100.00%
  fixed_amount_kobo INTEGER NOT NULL DEFAULT 0,
  property_category_id INTEGER,
  sales_type TEXT,
  branch_id INTEGER,
  team_id INTEGER,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (plan_id) REFERENCES commission_plans(id) ON DELETE CASCADE,
  FOREIGN KEY (property_category_id) REFERENCES property_categories(id),
  FOREIGN KEY (branch_id) REFERENCES branches(id),
  FOREIGN KEY (team_id) REFERENCES teams(id)
);

CREATE INDEX IF NOT EXISTS idx_commission_rules_plan ON commission_plan_rules(plan_id);
CREATE INDEX IF NOT EXISTS idx_commission_rules_role ON commission_plan_rules(role_name);

-- 4. Commission entries preserve the attribution snapshot and calculated values.
CREATE TABLE IF NOT EXISTS commission_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  commission_ref TEXT NOT NULL UNIQUE,
  plan_id INTEGER NOT NULL,
  rule_id INTEGER NOT NULL,
  client_id INTEGER NOT NULL,
  property_id INTEGER,
  payment_id INTEGER,
  recipient_user_id INTEGER NOT NULL,
  recipient_role TEXT NOT NULL,
  branch_id INTEGER,
  team_id INTEGER,
  marketer_id INTEGER,
  team_lead_id INTEGER,
  source_type TEXT NOT NULL, -- contract | payment | fixed
  source_key TEXT NOT NULL UNIQUE,
  basis TEXT NOT NULL, -- contract_value | verified_collections | fixed
  qualifying_amount_kobo INTEGER NOT NULL DEFAULT 0,
  rate_bps INTEGER NOT NULL DEFAULT 0,
  commission_kobo INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'Calculated',
  approval_required INTEGER NOT NULL DEFAULT 1,
  paid_kobo INTEGER NOT NULL DEFAULT 0,
  adjusted_kobo INTEGER NOT NULL DEFAULT 0,
  approved_by INTEGER,
  approved_at TEXT,
  rejected_by INTEGER,
  rejected_at TEXT,
  rejection_reason TEXT,
  metadata TEXT,
  created_by INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (plan_id) REFERENCES commission_plans(id),
  FOREIGN KEY (rule_id) REFERENCES commission_plan_rules(id),
  FOREIGN KEY (client_id) REFERENCES clients(id),
  FOREIGN KEY (property_id) REFERENCES properties(id),
  FOREIGN KEY (payment_id) REFERENCES payments(id),
  FOREIGN KEY (recipient_user_id) REFERENCES users(id),
  FOREIGN KEY (branch_id) REFERENCES branches(id),
  FOREIGN KEY (team_id) REFERENCES teams(id),
  FOREIGN KEY (marketer_id) REFERENCES users(id),
  FOREIGN KEY (team_lead_id) REFERENCES users(id),
  FOREIGN KEY (approved_by) REFERENCES users(id),
  FOREIGN KEY (rejected_by) REFERENCES users(id),
  FOREIGN KEY (created_by) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_commission_entries_plan ON commission_entries(plan_id);
CREATE INDEX IF NOT EXISTS idx_commission_entries_client ON commission_entries(client_id);
CREATE INDEX IF NOT EXISTS idx_commission_entries_payment ON commission_entries(payment_id);
CREATE INDEX IF NOT EXISTS idx_commission_entries_recipient ON commission_entries(recipient_user_id);
CREATE INDEX IF NOT EXISTS idx_commission_entries_branch ON commission_entries(branch_id);
CREATE INDEX IF NOT EXISTS idx_commission_entries_team ON commission_entries(team_id);
CREATE INDEX IF NOT EXISTS idx_commission_entries_status ON commission_entries(status);
CREATE INDEX IF NOT EXISTS idx_commission_entries_created ON commission_entries(created_at);

-- 5. Immutable attribution snapshot captured when the entry is generated.
CREATE TABLE IF NOT EXISTS commission_attributions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entry_id INTEGER NOT NULL UNIQUE,
  marketer_id INTEGER,
  team_lead_id INTEGER,
  branch_id INTEGER,
  team_id INTEGER,
  relationship_manager_id INTEGER,
  source TEXT,
  snapshot_json TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (entry_id) REFERENCES commission_entries(id) ON DELETE CASCADE,
  FOREIGN KEY (marketer_id) REFERENCES users(id),
  FOREIGN KEY (team_lead_id) REFERENCES users(id),
  FOREIGN KEY (branch_id) REFERENCES branches(id),
  FOREIGN KEY (team_id) REFERENCES teams(id),
  FOREIGN KEY (relationship_manager_id) REFERENCES users(id)
);

-- 6. Approval / rejection / submission trail
CREATE TABLE IF NOT EXISTS commission_approvals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entry_id INTEGER NOT NULL,
  action TEXT NOT NULL, -- submit | approve | reject | reverse
  actor_user_id INTEGER NOT NULL,
  reason TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (entry_id) REFERENCES commission_entries(id) ON DELETE CASCADE,
  FOREIGN KEY (actor_user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_commission_approvals_entry ON commission_approvals(entry_id);

-- 7. Commission payments with receipt storage and idempotency
CREATE TABLE IF NOT EXISTS commission_payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  payment_ref TEXT NOT NULL UNIQUE,
  idempotency_key TEXT UNIQUE,
  entry_id INTEGER NOT NULL,
  amount_kobo INTEGER NOT NULL,
  method TEXT NOT NULL,
  external_reference TEXT,
  evidence TEXT,
  notes TEXT,
  paid_by INTEGER NOT NULL,
  paid_at TEXT NOT NULL DEFAULT (datetime('now')),
  r2_key TEXT,
  receipt_ref TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (entry_id) REFERENCES commission_entries(id),
  FOREIGN KEY (paid_by) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_commission_payments_entry ON commission_payments(entry_id);

-- 8. Traceable signed adjustments for refunds, reversals and corrections.
CREATE TABLE IF NOT EXISTS commission_adjustments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entry_id INTEGER NOT NULL,
  adjustment_type TEXT NOT NULL, -- refund | reversal | correction | manual
  amount_kobo INTEGER NOT NULL, -- signed; negative for refunds/reversals
  reason TEXT NOT NULL,
  source_payment_id INTEGER,
  source_key TEXT UNIQUE,
  created_by INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (entry_id) REFERENCES commission_entries(id),
  FOREIGN KEY (source_payment_id) REFERENCES payments(id),
  FOREIGN KEY (created_by) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_commission_adjustments_entry ON commission_adjustments(entry_id);

-- 9. Generated financial reports
CREATE TABLE IF NOT EXISTS financial_report_jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  report_ref TEXT NOT NULL UNIQUE,
  report_type TEXT NOT NULL,
  format TEXT NOT NULL, -- csv | pdf
  filters_json TEXT,
  status TEXT NOT NULL DEFAULT 'Generated',
  r2_key TEXT,
  requested_by INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at TEXT,
  error TEXT,
  FOREIGN KEY (requested_by) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_report_jobs_requested_by ON financial_report_jobs(requested_by);
CREATE INDEX IF NOT EXISTS idx_report_jobs_type ON financial_report_jobs(report_type);
CREATE INDEX IF NOT EXISTS idx_report_jobs_created ON financial_report_jobs(created_at);
