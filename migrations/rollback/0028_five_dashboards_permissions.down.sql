-- Manual rollback for 0028_five_dashboards_permissions.sql. Do not apply automatically.
PRAGMA foreign_keys = ON;

DROP INDEX IF EXISTS idx_financial_change_requests_status;
DROP INDEX IF EXISTS idx_financial_change_requests_client;
DROP TABLE IF EXISTS client_financial_change_requests;

DROP INDEX IF EXISTS idx_targets_owner;
DROP INDEX IF EXISTS idx_targets_period;
DROP TABLE IF EXISTS targets;

DROP INDEX IF EXISTS idx_permission_change_target;
DROP TABLE IF EXISTS permission_change_log;

DROP INDEX IF EXISTS idx_user_permissions_user;
DROP INDEX IF EXISTS idx_user_permissions_active;
DROP TABLE IF EXISTS user_permissions;

ALTER TABLE role_permissions DROP COLUMN scope;

DELETE FROM permissions WHERE name IN (
  'finance.approvals.view','finance.approvals.perform','finance.payments.record',
  'finance.payments.verify','finance.payments.adjust','finance.reconciliation.run',
  'finance.providers.manage','finance.records.view','finance.payments.export',
  'commission.totals.view','commission.rules.view','commission.rules.manage',
  'commission.entries.generate','commission.entries.approve','commission.entries.pay',
  'commission.entries.adjust','referral.commission.manage','clients.financial.edit',
  'clients.edit.details','clients.edit.branch','clients.assign','clients.view',
  'staff.manage','properties.manage','properties.listing.approve','targets.manage',
  'dashboards.view.other_roles'
);

DELETE FROM roles WHERE name IN ('Sub Admin','GSM','Accountant');
