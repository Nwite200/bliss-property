-- Phase 12: payment plans, defaulting, inspections, commission versioning and
-- multi-provider payments. Existing tables are extended in place.
PRAGMA foreign_keys = ON;

-- ---------------------------------------------------------------------------
-- 1. Payment plans and expected schedule items
-- ---------------------------------------------------------------------------
ALTER TABLE payment_schedules ADD COLUMN plan_type TEXT NOT NULL DEFAULT 'outright';
ALTER TABLE payment_schedules ADD COLUMN start_date TEXT;
ALTER TABLE payment_schedules ADD COLUMN grace_days INTEGER NOT NULL DEFAULT 0;
ALTER TABLE payment_schedules ADD COLUMN number_of_installments INTEGER;
ALTER TABLE payment_schedules ADD COLUMN is_easy_buy INTEGER NOT NULL DEFAULT 0;
ALTER TABLE payment_schedules ADD COLUMN schedule_version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE payment_schedules ADD COLUMN follow_up_owner_id INTEGER REFERENCES users(id);
ALTER TABLE payment_schedules ADD COLUMN follow_up_status TEXT;
ALTER TABLE payment_schedules ADD COLUMN next_follow_up_date TEXT;

UPDATE payment_schedules
SET plan_type = CASE
  WHEN frequency_days = 1 THEN 'daily'
  WHEN frequency_days = 7 THEN 'weekly'
  WHEN frequency_days = 15 THEN 'bi_monthly'
  WHEN frequency_days = 30 THEN 'monthly'
  ELSE 'part_payment'
END
WHERE plan_type = 'outright';

UPDATE payment_schedules
SET is_easy_buy = CASE WHEN plan_type IN ('daily','weekly','bi_monthly','monthly') THEN 1 ELSE 0 END,
    start_date = COALESCE(start_date, date(created_at)),
    grace_days = COALESCE(grace_days, 0);

CREATE INDEX IF NOT EXISTS idx_schedules_plan_type ON payment_schedules(plan_type);
CREATE INDEX IF NOT EXISTS idx_schedules_start ON payment_schedules(start_date);
CREATE INDEX IF NOT EXISTS idx_schedules_follow_up ON payment_schedules(next_follow_up_date);

CREATE TABLE IF NOT EXISTS payment_schedule_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  schedule_id INTEGER NOT NULL,
  sequence_no INTEGER NOT NULL,
  due_date TEXT NOT NULL,
  amount_kobo INTEGER NOT NULL,
  paid_kobo INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'expected',
  payment_id INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(schedule_id, sequence_no),
  FOREIGN KEY (schedule_id) REFERENCES payment_schedules(id) ON DELETE CASCADE,
  FOREIGN KEY (payment_id) REFERENCES payments(id)
);

CREATE INDEX IF NOT EXISTS idx_schedule_items_due ON payment_schedule_items(due_date, status);
CREATE INDEX IF NOT EXISTS idx_schedule_items_schedule ON payment_schedule_items(schedule_id);

-- Existing schedules without generated items get one catch-up item so they
-- participate in defaulting detection immediately after deployment.
INSERT OR IGNORE INTO payment_schedule_items (schedule_id, sequence_no, due_date, amount_kobo)
SELECT s.id, 1, date(s.next_due_date), MAX(0, s.total_kobo - s.deposit_kobo)
FROM payment_schedules s
WHERE s.status = 'active' AND NOT EXISTS (
  SELECT 1 FROM payment_schedule_items i WHERE i.schedule_id = s.id
);

CREATE TABLE IF NOT EXISTS defaulting_follow_ups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  schedule_id INTEGER NOT NULL,
  client_id INTEGER NOT NULL,
  owner_user_id INTEGER,
  note TEXT NOT NULL,
  next_follow_up_date TEXT,
  status TEXT NOT NULL DEFAULT 'contacted',
  created_by INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (schedule_id) REFERENCES payment_schedules(id) ON DELETE CASCADE,
  FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE,
  FOREIGN KEY (owner_user_id) REFERENCES users(id),
  FOREIGN KEY (created_by) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_defaulting_followups_schedule ON defaulting_follow_ups(schedule_id, created_at);
CREATE INDEX IF NOT EXISTS idx_defaulting_followups_next ON defaulting_follow_ups(next_follow_up_date);

-- ---------------------------------------------------------------------------
-- 2. Lead inspections and bulk import support
-- ---------------------------------------------------------------------------
ALTER TABLE leads ADD COLUMN inspection_date TEXT;
ALTER TABLE leads ADD COLUMN inspection_time TEXT;
ALTER TABLE leads ADD COLUMN inspection_property_id INTEGER REFERENCES properties(id);
ALTER TABLE leads ADD COLUMN inspection_notes TEXT;

CREATE INDEX IF NOT EXISTS idx_leads_inspection_date ON leads(inspection_date);
CREATE INDEX IF NOT EXISTS idx_leads_source ON leads(source);

-- ---------------------------------------------------------------------------
-- 3. Commission plan versioning, easy-buy commissionable basis and permission
-- ---------------------------------------------------------------------------
ALTER TABLE users ADD COLUMN commission_access INTEGER NOT NULL DEFAULT 0;

-- Default access: MD, Super Admin and Head Accountant. Finance and every other
-- role must be granted explicitly by an MD / Super Admin.
UPDATE users SET commission_access = 1
WHERE role_id IN (SELECT id FROM roles WHERE name IN ('Managing Director','Super Admin','Head Accountant'));

ALTER TABLE commission_plans ADD COLUMN commissionable_mode TEXT NOT NULL DEFAULT 'full';
ALTER TABLE commission_plans ADD COLUMN commissionable_first_months INTEGER NOT NULL DEFAULT 2;
ALTER TABLE commission_plans ADD COLUMN commissionable_percent_bps INTEGER NOT NULL DEFAULT 10000;
ALTER TABLE commission_plans ADD COLUMN commissionable_cap_kobo INTEGER NOT NULL DEFAULT 0;
ALTER TABLE commission_plans ADD COLUMN current_version_no INTEGER NOT NULL DEFAULT 1;

CREATE TABLE IF NOT EXISTS commission_plan_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  plan_id INTEGER NOT NULL,
  version_no INTEGER NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  calculation_basis TEXT NOT NULL,
  effective_from TEXT,
  effective_to TEXT,
  commissionable_mode TEXT NOT NULL DEFAULT 'full',
  commissionable_first_months INTEGER NOT NULL DEFAULT 2,
  commissionable_percent_bps INTEGER NOT NULL DEFAULT 10000,
  commissionable_cap_kobo INTEGER NOT NULL DEFAULT 0,
  rules_json TEXT NOT NULL DEFAULT '[]',
  change_reason TEXT,
  created_by INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(plan_id, version_no),
  FOREIGN KEY (plan_id) REFERENCES commission_plans(id) ON DELETE CASCADE,
  FOREIGN KEY (created_by) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_commission_versions_plan ON commission_plan_versions(plan_id, version_no);

ALTER TABLE commission_entries ADD COLUMN plan_version_id INTEGER REFERENCES commission_plan_versions(id);
ALTER TABLE commission_entries ADD COLUMN plan_version_no INTEGER NOT NULL DEFAULT 1;
ALTER TABLE commission_entries ADD COLUMN payment_amount_kobo INTEGER NOT NULL DEFAULT 0;
ALTER TABLE commission_entries ADD COLUMN commissionable_mode TEXT;

CREATE INDEX IF NOT EXISTS idx_commission_entries_plan_version ON commission_entries(plan_id, plan_version_no);
CREATE INDEX IF NOT EXISTS idx_commission_entries_status_period ON commission_entries(status, created_at);

-- Create version 1 snapshots for plans that already exist.
INSERT OR IGNORE INTO commission_plan_versions
  (plan_id, version_no, name, description, calculation_basis, effective_from, effective_to,
   commissionable_mode, commissionable_first_months, commissionable_percent_bps,
   commissionable_cap_kobo, rules_json, created_by, created_at)
SELECT p.id, 1, p.name, p.description, p.calculation_basis, p.effective_from, p.effective_to,
       p.commissionable_mode, p.commissionable_first_months, p.commissionable_percent_bps,
       p.commissionable_cap_kobo,
       COALESCE((SELECT json_group_array(json_object(
         'id', r.id, 'role_name', r.role_name, 'rate_bps', r.rate_bps,
         'fixed_amount_kobo', r.fixed_amount_kobo,
         'property_category_id', r.property_category_id, 'sales_type', r.sales_type,
         'branch_id', r.branch_id, 'team_id', r.team_id, 'is_active', r.is_active
       )) FROM commission_plan_rules r WHERE r.plan_id=p.id), '[]'),
       p.created_by, p.created_at
FROM commission_plans p;

-- ---------------------------------------------------------------------------
-- 4. Multi-provider payment configuration and payment metadata
-- ---------------------------------------------------------------------------
ALTER TABLE payments ADD COLUMN provider TEXT NOT NULL DEFAULT 'wema_alat';
ALTER TABLE payments ADD COLUMN provider_reference TEXT;

UPDATE payments
SET provider_reference = COALESCE(provider_ref, gateway_purchase_id, transaction_ref)
WHERE provider_reference IS NULL;

CREATE INDEX IF NOT EXISTS idx_payments_provider_ref ON payments(provider, provider_reference);
CREATE INDEX IF NOT EXISTS idx_payments_provider_status ON payments(provider, status);

ALTER TABLE virtual_accounts ADD COLUMN provider_key TEXT;
UPDATE virtual_accounts SET provider_key = provider WHERE provider_key IS NULL;

ALTER TABLE provider_configs ADD COLUMN is_default INTEGER NOT NULL DEFAULT 0;
ALTER TABLE provider_configs ADD COLUMN webhook_path TEXT;
ALTER TABLE provider_configs ADD COLUMN adapter_key TEXT;

INSERT OR IGNORE INTO provider_configs (provider_key, provider_name, status, environment, config_json, webhook_path, adapter_key)
VALUES ('alatpay', 'ALATPay by Wema Bank', 'Not configured', 'sandbox',
  '{"webhook_url":"/api/webhooks/alatpay"}', '/api/webhooks/alatpay', 'alatpay');

INSERT OR IGNORE INTO provider_configs (provider_key, provider_name, status, environment, config_json, webhook_path, adapter_key)
VALUES ('paystack', 'Paystack', 'Not configured', 'sandbox',
  '{"webhook_url":"/api/webhooks/paystack"}', '/api/webhooks/paystack', 'paystack');

UPDATE provider_configs
SET webhook_path = COALESCE(webhook_path, '/api/webhooks/' || provider_key),
    adapter_key = COALESCE(adapter_key, provider_key);

UPDATE provider_configs SET is_default = 1
WHERE provider_key = 'wema_alat'
  AND NOT EXISTS (SELECT 1 FROM provider_configs WHERE is_default = 1);

CREATE INDEX IF NOT EXISTS idx_provider_configs_default ON provider_configs(is_default);
