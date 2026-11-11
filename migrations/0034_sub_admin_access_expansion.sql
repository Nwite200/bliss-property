-- Phase 34: Sub Admin access expansion & MD / Super Admin dashboard parity
-- Sub Admin gains full executive operational access (staff, properties, clients, teams, reports, audit)
-- but CANNOT approve or record financial transactions.
PRAGMA foreign_keys = ON;

-- Ensure Sub Admin has all permitted operational permissions
INSERT OR IGNORE INTO role_permissions (role_id, permission_id, scope)
SELECT r.id, p.id, 'national'
FROM roles r
CROSS JOIN permissions p
WHERE r.name = 'Sub Admin'
  AND p.name IN (
    'admin.audit',
    'branches.read',
    'chat.manage',
    'clients.assign',
    'clients.edit.branch',
    'clients.edit.details',
    'clients.read',
    'clients.view',
    'commission.rules.view',
    'commission.totals.view',
    'dashboards.view.other_roles',
    'finance.approvals.view',
    'finance.payments.export',
    'finance.read',
    'finance.records.view',
    'properties.listing.approve',
    'properties.manage',
    'reports.read',
    'settings.manage',
    'staff.manage',
    'targets.manage',
    'teams.manage',
    'users.create',
    'users.deactivate',
    'users.read',
    'users.update'
  );

-- Strictly remove any financial transaction approval or recording permissions from Sub Admin
DELETE FROM role_permissions
WHERE role_id = (SELECT id FROM roles WHERE name = 'Sub Admin')
  AND permission_id IN (
    SELECT id FROM permissions WHERE name IN (
      'finance.approvals.perform',
      'finance.payments.verify',
      'finance.payments.record',
      'finance.payments.adjust',
      'finance.reconciliation.run',
      'finance.providers.manage',
      'commission.entries.generate',
      'commission.entries.approve',
      'commission.entries.pay',
      'commission.entries.adjust',
      'commission.rules.manage',
      'referral.commission.manage',
      'clients.financial.edit',
      'admin.permissions',
      'admin.roles',
      'admin.system'
    )
  );

-- Ensure Managing Director and Super Admin have all 42 permissions with national scope
INSERT OR IGNORE INTO role_permissions (role_id, permission_id, scope)
SELECT r.id, p.id, 'national'
FROM roles r
CROSS JOIN permissions p
WHERE r.name IN ('Managing Director', 'Super Admin');

