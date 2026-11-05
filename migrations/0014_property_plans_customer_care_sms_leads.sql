-- Phase 13: property payment-plan catalogue, locked purchase terms, customer
-- care, SMS delivery and lead pipeline refinements.
PRAGMA foreign_keys = ON;

-- ---------------------------------------------------------------------------
-- 1. Property payment-plan catalogue
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS property_payment_plans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  property_id INTEGER NOT NULL,
  plan_type TEXT NOT NULL,
  total_price_kobo INTEGER NOT NULL,
  deposit_kobo INTEGER NOT NULL DEFAULT 0,
  installment_kobo INTEGER NOT NULL DEFAULT 0,
  duration_months INTEGER,
  number_of_installments INTEGER,
  is_enabled INTEGER NOT NULL DEFAULT 1,
  notes TEXT,
  created_by INTEGER NOT NULL,
  updated_by INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(property_id, plan_type),
  FOREIGN KEY (property_id) REFERENCES properties(id) ON DELETE CASCADE,
  FOREIGN KEY (created_by) REFERENCES users(id),
  FOREIGN KEY (updated_by) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_property_plans_property ON property_payment_plans(property_id, is_enabled);
CREATE INDEX IF NOT EXISTS idx_property_plans_type ON property_payment_plans(plan_type);

-- Immutable purchase-time snapshot. Later edits to the property catalogue must
-- not change an existing client's agreed price or schedule.
ALTER TABLE clients ADD COLUMN property_payment_plan_id INTEGER REFERENCES property_payment_plans(id);
ALTER TABLE clients ADD COLUMN payment_plan_type TEXT;
ALTER TABLE clients ADD COLUMN payment_plan_total_kobo INTEGER;
ALTER TABLE clients ADD COLUMN payment_plan_deposit_kobo INTEGER;
ALTER TABLE clients ADD COLUMN payment_plan_installment_kobo INTEGER;
ALTER TABLE clients ADD COLUMN payment_plan_duration_months INTEGER;
ALTER TABLE clients ADD COLUMN payment_plan_number_of_installments INTEGER;
ALTER TABLE clients ADD COLUMN payment_plan_locked_at TEXT;
ALTER TABLE clients ADD COLUMN payment_plan_locked_json TEXT;

ALTER TABLE client_properties ADD COLUMN property_payment_plan_id INTEGER REFERENCES property_payment_plans(id);
ALTER TABLE client_properties ADD COLUMN plan_type TEXT;
ALTER TABLE client_properties ADD COLUMN plan_total_kobo INTEGER;
ALTER TABLE client_properties ADD COLUMN plan_deposit_kobo INTEGER;
ALTER TABLE client_properties ADD COLUMN plan_installment_kobo INTEGER;
ALTER TABLE client_properties ADD COLUMN plan_duration_months INTEGER;
ALTER TABLE client_properties ADD COLUMN plan_number_of_installments INTEGER;
ALTER TABLE client_properties ADD COLUMN plan_locked_at TEXT;
ALTER TABLE client_properties ADD COLUMN plan_locked_json TEXT;

ALTER TABLE payment_schedules ADD COLUMN property_payment_plan_id INTEGER REFERENCES property_payment_plans(id);
ALTER TABLE payment_schedules ADD COLUMN locked_plan_json TEXT;

CREATE INDEX IF NOT EXISTS idx_clients_property_plan ON clients(property_payment_plan_id);
CREATE INDEX IF NOT EXISTS idx_schedules_property_plan ON payment_schedules(property_payment_plan_id);

-- ---------------------------------------------------------------------------
-- 2. Customer care accounts and workflow
-- ---------------------------------------------------------------------------
INSERT OR IGNORE INTO roles (name) VALUES ('Customer Care');

ALTER TABLE users ADD COLUMN care_scope TEXT; -- 'branch' | 'national'
ALTER TABLE users ADD COLUMN property_plans_access INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN sms_access INTEGER NOT NULL DEFAULT 0;

UPDATE users SET property_plans_access = 1, sms_access = 1
WHERE role_id IN (SELECT id FROM roles WHERE name IN ('Managing Director','Super Admin','Head Accountant'));

CREATE TABLE IF NOT EXISTS client_care_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id INTEGER NOT NULL UNIQUE,
  care_status TEXT NOT NULL DEFAULT 'pending_clearance', -- pending_clearance | cleared
  assigned_user_id INTEGER,
  clearance_note TEXT,
  cleared_by INTEGER,
  cleared_at TEXT,
  last_call_at TEXT,
  next_follow_up_date TEXT,
  updated_by INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE,
  FOREIGN KEY (assigned_user_id) REFERENCES users(id),
  FOREIGN KEY (cleared_by) REFERENCES users(id),
  FOREIGN KEY (updated_by) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_care_status ON client_care_records(care_status);
CREATE INDEX IF NOT EXISTS idx_care_assigned ON client_care_records(assigned_user_id);

CREATE TABLE IF NOT EXISTS client_care_calls (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id INTEGER NOT NULL,
  care_user_id INTEGER NOT NULL,
  call_type TEXT NOT NULL DEFAULT 'call', -- call | whatsapp | visit | sms | other
  note TEXT NOT NULL,
  outcome TEXT,
  next_follow_up_date TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE,
  FOREIGN KEY (care_user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_care_calls_client ON client_care_calls(client_id, created_at);
CREATE INDEX IF NOT EXISTS idx_care_calls_user ON client_care_calls(care_user_id, created_at);

-- ---------------------------------------------------------------------------
-- 3. SMS notifications
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sms_templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  template_key TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  body TEXT NOT NULL,
  language TEXT NOT NULL DEFAULT 'en',
  is_active INTEGER NOT NULL DEFAULT 1,
  created_by INTEGER,
  updated_by INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (created_by) REFERENCES users(id),
  FOREIGN KEY (updated_by) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS sms_settings (
  setting_key TEXT PRIMARY KEY,
  setting_value TEXT,
  updated_by INTEGER,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (updated_by) REFERENCES users(id)
);

INSERT OR IGNORE INTO sms_settings (setting_key, setting_value) VALUES
  ('sms_enabled', '0'),
  ('sms_provider', 'termii'),
  ('sms_sender_id', 'BlissLegacy'),
  ('sms_low_credit_threshold', '1000'),
  ('sms_reminders_enabled', '0'),
  ('sms_defaulting_reminders_enabled', '0'),
  ('sms_reminder_days', '3'),
  ('sms_defaulting_frequency_days', '3'),
  ('sms_statement_day', '1'),
  ('sms_credit_balance', ''),
  ('sms_credit_currency', 'NGN'),
  ('sms_credit_checked_at', ''),
  ('sms_low_balance_alerted_at', '');

CREATE TABLE IF NOT EXISTS sms_templates_seed_marker (id INTEGER PRIMARY KEY CHECK (id=1));
INSERT OR IGNORE INTO sms_templates_seed_marker (id) VALUES (1);

INSERT OR IGNORE INTO sms_templates (template_key, name, body, language) VALUES
  ('payment_received', 'Payment received',
   'Payment received: NGN {amount} for {property}. New balance: NGN {balance}. Date: {date}. Ref: {reference}. Thank you, Bliss Legacy.', 'en'),
  ('monthly_statement', 'Monthly balance statement',
   'Balance statement: paid NGN {paid} of NGN {total}; outstanding NGN {balance}. Next due: {next_due}. Bliss Legacy.', 'en'),
  ('payment_reminder', 'Payment reminder',
   'Reminder: NGN {amount} is due on {due_date} for {property}. Ref {reference}. Bliss Legacy.', 'en'),
  ('defaulting_reminder', 'Defaulting reminder',
   '{days} day(s) overdue: NGN {amount} behind on {property}. Please pay or contact Bliss Legacy.', 'en'),
  ('account_created', 'Account created',
   'Welcome {name}. Your Bliss Legacy client reference is {reference}. We will keep you updated by SMS.', 'en');

CREATE TABLE IF NOT EXISTS sms_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id INTEGER,
  payment_id INTEGER,
  schedule_id INTEGER,
  template_key TEXT,
  phone_e164 TEXT NOT NULL,
  body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued', -- queued | sent | delivered | failed | opted_out | skipped
  provider TEXT,
  provider_message_id TEXT,
  provider_cost_kobo INTEGER,
  error TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  idempotency_key TEXT UNIQUE,
  queued_at TEXT NOT NULL DEFAULT (datetime('now')),
  sent_at TEXT,
  delivered_at TEXT,
  failed_at TEXT,
  next_attempt_at TEXT,
  created_by INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE SET NULL,
  FOREIGN KEY (payment_id) REFERENCES payments(id) ON DELETE SET NULL,
  FOREIGN KEY (schedule_id) REFERENCES payment_schedules(id) ON DELETE SET NULL,
  FOREIGN KEY (created_by) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_sms_messages_client ON sms_messages(client_id, created_at);
CREATE INDEX IF NOT EXISTS idx_sms_messages_payment ON sms_messages(payment_id);
CREATE INDEX IF NOT EXISTS idx_sms_messages_status ON sms_messages(status, created_at);
CREATE INDEX IF NOT EXISTS idx_sms_messages_provider ON sms_messages(provider, provider_message_id);

CREATE TABLE IF NOT EXISTS sms_optouts (
  client_id INTEGER PRIMARY KEY,
  opted_out INTEGER NOT NULL DEFAULT 1,
  reason TEXT,
  updated_by INTEGER,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE,
  FOREIGN KEY (updated_by) REFERENCES users(id)
);

-- ---------------------------------------------------------------------------
-- 4. Lead pipeline refinements
-- ---------------------------------------------------------------------------
ALTER TABLE leads ADD COLUMN referrer TEXT;
ALTER TABLE leads ADD COLUMN lead_temperature TEXT; -- Hot | Warm | Cold
ALTER TABLE leads ADD COLUMN temperature_updated_at TEXT;
ALTER TABLE leads ADD COLUMN lost_reason TEXT;

ALTER TABLE lead_follow_ups ADD COLUMN contact_type TEXT;
ALTER TABLE lead_follow_ups ADD COLUMN contacted_at TEXT;
UPDATE lead_follow_ups SET contact_type = COALESCE(channel, 'call') WHERE contact_type IS NULL;
UPDATE lead_follow_ups SET contacted_at = created_at WHERE contacted_at IS NULL;

CREATE TABLE IF NOT EXISTS lead_temperature_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lead_id INTEGER NOT NULL,
  old_temperature TEXT,
  new_temperature TEXT NOT NULL,
  changed_by INTEGER NOT NULL,
  reason TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE CASCADE,
  FOREIGN KEY (changed_by) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_lead_temperature ON leads(lead_temperature);
CREATE INDEX IF NOT EXISTS idx_lead_temperature_history ON lead_temperature_history(lead_id, created_at);
CREATE INDEX IF NOT EXISTS idx_leads_lost_reason ON leads(lost_reason);
