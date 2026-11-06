-- Manual rollback for 0029_finance_permission_correction.sql. Do not apply automatically.
PRAGMA foreign_keys = ON;

INSERT OR IGNORE INTO role_permissions (role_id, permission_id, scope)
SELECT r.id, p.id, 'national'
FROM roles r JOIN permissions p ON p.name IN (
  'commission.entries.generate','commission.entries.approve',
  'commission.entries.pay','commission.entries.adjust'
)
WHERE r.name = 'Finance Officer';
