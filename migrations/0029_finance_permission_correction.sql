-- Phase 29: permission correction. Finance Officer keeps the financial approvals
-- held today but does not gain commission-entry approval without commission access.
PRAGMA foreign_keys = ON;

DELETE FROM role_permissions
WHERE role_id = (SELECT id FROM roles WHERE name='Finance Officer')
  AND permission_id IN (
    SELECT id FROM permissions WHERE name IN (
      'commission.entries.generate','commission.entries.approve',
      'commission.entries.pay','commission.entries.adjust'
    )
  );
