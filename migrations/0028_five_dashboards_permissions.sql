-- Phase 28: five-dashboards roles, configurable permissions, financial approval
-- catalogue support, targets, and branch-manager financial change requests.
PRAGMA foreign_keys = ON;

INSERT OR IGNORE INTO roles (name) VALUES ('Sub Admin'), ('GSM'), ('Accountant');

INSERT OR IGNORE INTO permissions (name) VALUES
  ('finance.approvals.view'),
  ('finance.approvals.perform'),
  ('finance.payments.record'),
  ('finance.payments.verify'),
  ('finance.payments.adjust'),
  ('finance.reconciliation.run'),
  ('finance.providers.manage'),
  ('finance.records.view'),
  ('finance.payments.export'),
  ('commission.totals.view'),
  ('commission.rules.view'),
  ('commission.rules.manage'),
  ('commission.entries.generate'),
  ('commission.entries.approve'),
  ('commission.entries.pay'),
  ('commission.entries.adjust'),
  ('referral.commission.manage'),
  ('clients.financial.edit'),
  ('clients.edit.details'),
  ('clients.edit.branch'),
  ('clients.assign'),
  ('clients.view'),
  ('staff.manage'),
  ('properties.manage'),
  ('properties.listing.approve'),
  ('targets.manage'),
  ('dashboards.view.other_roles');

ALTER TABLE role_permissions ADD COLUMN scope TEXT NOT NULL DEFAULT 'national';

CREATE TABLE IF NOT EXISTS user_permissions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  permission_name TEXT NOT NULL,
  scope TEXT NOT NULL DEFAULT 'national',
  granted_by INTEGER,
  reason TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  revoked_at TEXT,
  revoked_by INTEGER,
  revoke_reason TEXT,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (granted_by) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (revoked_by) REFERENCES users(id) ON DELETE SET NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_user_permissions_active
  ON user_permissions(user_id, permission_name) WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_user_permissions_user ON user_permissions(user_id, created_at);

CREATE TABLE IF NOT EXISTS permission_change_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_user_id INTEGER,
  target_type TEXT NOT NULL,
  target_id INTEGER NOT NULL,
  permission_name TEXT NOT NULL,
  action TEXT NOT NULL, -- grant | revoke
  scope TEXT,
  reason TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (actor_user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_permission_change_target
  ON permission_change_log(target_type, target_id, created_at);

CREATE TABLE IF NOT EXISTS targets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  target_type TEXT NOT NULL, -- branch | staff | role
  target_id INTEGER,
  metric TEXT NOT NULL DEFAULT 'revenue', -- revenue | clients | leads | collections
  period_type TEXT NOT NULL DEFAULT 'month', -- day | week | month | quarter | year | custom
  period_start TEXT NOT NULL,
  period_end TEXT NOT NULL,
  amount_kobo INTEGER NOT NULL DEFAULT 0,
  notes TEXT,
  created_by INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_targets_period ON targets(period_start, period_end);
CREATE INDEX IF NOT EXISTS idx_targets_owner ON targets(target_type, target_id);

CREATE TABLE IF NOT EXISTS client_financial_change_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id INTEGER NOT NULL,
  requested_by INTEGER,
  change_type TEXT NOT NULL, -- price | plan | schedule | balance
  payload_json TEXT NOT NULL,
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending', -- pending | approved | rejected
  approved_by INTEGER,
  approved_at TEXT,
  rejection_reason TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE,
  FOREIGN KEY (requested_by) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (approved_by) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_financial_change_requests_client
  ON client_financial_change_requests(client_id, created_at);
CREATE INDEX IF NOT EXISTS idx_financial_change_requests_status
  ON client_financial_change_requests(status, created_at);

-- Owner roles keep every permission.
INSERT OR IGNORE INTO role_permissions (role_id, permission_id, scope)
SELECT r.id, p.id, 'national'
FROM roles r, permissions p
WHERE r.name IN ('Managing Director', 'Super Admin');

-- Sub Admin: read-only finance + operational client/property/staff/target access.
INSERT OR IGNORE INTO role_permissions (role_id, permission_id, scope)
SELECT r.id, p.id, 'national'
FROM roles r JOIN permissions p ON p.name IN (
  'finance.approvals.view', 'finance.records.view', 'commission.totals.view',
  'clients.edit.details', 'clients.edit.branch', 'clients.assign', 'clients.view',
  'staff.manage', 'properties.manage', 'targets.manage', 'dashboards.view.other_roles'
)
WHERE r.name = 'Sub Admin';

-- GSM: targets and operational visibility only. No commission totals by default.
INSERT OR IGNORE INTO role_permissions (role_id, permission_id, scope)
SELECT r.id, p.id, 'national'
FROM roles r JOIN permissions p ON p.name IN (
  'targets.manage', 'dashboards.view.other_roles', 'clients.view'
)
WHERE r.name = 'GSM';

-- Accountant: financial records, payment exports and commission totals; no rates.
INSERT OR IGNORE INTO role_permissions (role_id, permission_id, scope)
SELECT r.id, p.id, 'national'
FROM roles r JOIN permissions p ON p.name IN (
  'finance.records.view', 'finance.payments.export', 'commission.totals.view',
  'dashboards.view.other_roles', 'clients.view'
)
WHERE r.name = 'Accountant';

-- Finance Officer and Head Accountant keep the financial approvals they hold today.
INSERT OR IGNORE INTO role_permissions (role_id, permission_id, scope)
SELECT r.id, p.id, 'national'
FROM roles r JOIN permissions p ON p.name IN (
  'finance.approvals.view', 'finance.approvals.perform',
  'finance.payments.record', 'finance.payments.verify', 'finance.payments.adjust',
  'finance.reconciliation.run', 'finance.providers.manage',
  'finance.records.view', 'finance.payments.export', 'commission.totals.view',
  'commission.entries.generate', 'commission.entries.approve', 'commission.entries.pay',
  'commission.entries.adjust', 'referral.commission.manage',
  'clients.financial.edit', 'clients.view'
)
WHERE r.name IN ('Finance Officer', 'Head Accountant');

-- Branch Manager keeps property management and operational client edits.
INSERT OR IGNORE INTO role_permissions (role_id, permission_id, scope)
SELECT r.id, p.id, 'branch'
FROM roles r JOIN permissions p ON p.name IN (
  'properties.manage', 'clients.edit.details', 'clients.assign', 'clients.view'
)
WHERE r.name = 'Branch Manager';

-- Customer Care keeps non-financial client detail access.
INSERT OR IGNORE INTO role_permissions (role_id, permission_id, scope)
SELECT r.id, p.id, 'national'
FROM roles r JOIN permissions p ON p.name IN ('clients.edit.details', 'clients.view')
WHERE r.name = 'Customer Care';

-- Project Manager is treated as a branch-scoped property manager.
INSERT OR IGNORE INTO role_permissions (role_id, permission_id, scope)
SELECT r.id, p.id, 'branch'
FROM roles r JOIN permissions p ON p.name IN ('properties.manage', 'clients.view')
WHERE r.name = 'Project Manager';

INSERT OR IGNORE INTO sms_templates (template_key, name, body, language) VALUES
  ('client_phone_changed', 'Client phone changed',
   'Your Bliss Legacy login phone number was changed to {phone}. If this was not you, contact customer care immediately.', 'en');
