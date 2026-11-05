-- Phase 11: hierarchical revenue visibility and immutable payment attribution
PRAGMA foreign_keys = ON;

INSERT OR IGNORE INTO roles (name) VALUES ('Project Manager'), ('Head Accountant');

-- Every user record gets a parent in the reporting hierarchy.
ALTER TABLE users ADD COLUMN manager_id INTEGER REFERENCES users(id);
CREATE INDEX IF NOT EXISTS idx_users_manager ON users(manager_id);

-- PM / Branch Manager report to the first active MD.
UPDATE users SET manager_id = (
  SELECT md.id FROM users md JOIN roles r ON r.id=md.role_id
  WHERE r.name='Managing Director' AND md.is_active=1 ORDER BY md.id LIMIT 1
)
WHERE manager_id IS NULL AND role_id IN (SELECT id FROM roles WHERE name IN ('Branch Manager','Project Manager'));

-- Team Leads report to the branch's PM/BM, else the MD.
UPDATE users SET manager_id = COALESCE(
  (SELECT bm.id FROM users bm JOIN roles r ON r.id=bm.role_id
   WHERE r.name IN ('Project Manager','Branch Manager') AND bm.branch_id=users.branch_id AND bm.is_active=1
   ORDER BY bm.id LIMIT 1),
  (SELECT md.id FROM users md JOIN roles r ON r.id=md.role_id
   WHERE r.name='Managing Director' AND md.is_active=1 ORDER BY md.id LIMIT 1)
)
WHERE manager_id IS NULL AND role_id = (SELECT id FROM roles WHERE name='Team Lead');

-- Staff with an active team report to the team lead; otherwise directly to PM/BM.
UPDATE users SET manager_id = COALESCE(
  (SELECT t.team_lead_user_id FROM team_members tm
   JOIN teams t ON t.id=tm.team_id
   WHERE tm.user_id=users.id AND t.is_active=1 AND t.team_lead_user_id IS NOT NULL
   ORDER BY t.id LIMIT 1),
  (SELECT bm.id FROM users bm JOIN roles r ON r.id=bm.role_id
   WHERE r.name IN ('Project Manager','Branch Manager') AND bm.branch_id=users.branch_id AND bm.is_active=1
   ORDER BY bm.id LIMIT 1),
  (SELECT md.id FROM users md JOIN roles r ON r.id=md.role_id
   WHERE r.name='Managing Director' AND md.is_active=1 ORDER BY md.id LIMIT 1)
)
WHERE manager_id IS NULL
  AND role_id NOT IN (SELECT id FROM roles WHERE name IN ('Super Admin','Managing Director','Head Accountant'));

-- Immutable payment attribution snapshot, written when a payment is credited.
ALTER TABLE payments ADD COLUMN revenue_staff_id INTEGER REFERENCES users(id);
ALTER TABLE payments ADD COLUMN revenue_team_lead_id INTEGER REFERENCES users(id);
ALTER TABLE payments ADD COLUMN revenue_pm_id INTEGER REFERENCES users(id);
ALTER TABLE payments ADD COLUMN revenue_branch_id INTEGER REFERENCES branches(id);
ALTER TABLE payments ADD COLUMN revenue_attribution_json TEXT;
ALTER TABLE payments ADD COLUMN revenue_attributed_at TEXT;

CREATE INDEX IF NOT EXISTS idx_payments_revenue_date ON payments(verified_at, status, is_demo, currency);
CREATE INDEX IF NOT EXISTS idx_payments_revenue_branch ON payments(revenue_branch_id, verified_at);
CREATE INDEX IF NOT EXISTS idx_payments_revenue_team_lead ON payments(revenue_team_lead_id, verified_at);
CREATE INDEX IF NOT EXISTS idx_payments_revenue_staff ON payments(revenue_staff_id, verified_at);

-- Backfill the best available attribution for existing verified/pending payments.
UPDATE payments SET
  revenue_staff_id = (
    SELECT COALESCE(c.created_by, c.original_marketer_id, c.referred_by_staff_id)
    FROM clients c WHERE c.id=payments.client_id
  ),
  revenue_branch_id = (
    SELECT c.assigned_branch_id FROM clients c WHERE c.id=payments.client_id
  )
WHERE revenue_staff_id IS NULL;

UPDATE payments SET revenue_team_lead_id = (
  SELECT COALESCE(
    (SELECT CASE WHEN r.name='Team Lead' THEN u.id END
       FROM users u JOIN roles r ON r.id=u.role_id WHERE u.id=c.created_by),
    c.team_lead_id,
    (SELECT CASE WHEN r2.name='Team Lead' THEN u2.id END
       FROM users u2 JOIN roles r2 ON r2.id=u2.role_id
       WHERE u2.id=(SELECT u3.manager_id FROM users u3 WHERE u3.id=c.created_by))
  )
  FROM clients c WHERE c.id=payments.client_id
)
WHERE revenue_team_lead_id IS NULL;

UPDATE payments SET revenue_pm_id = (
  SELECT COALESCE(
    (SELECT CASE WHEN r.name IN ('Project Manager','Branch Manager') THEN u.id END
       FROM users u JOIN roles r ON r.id=u.role_id
       WHERE u.id=(SELECT u2.manager_id FROM users u2 WHERE u2.id=c.created_by)),
    (SELECT CASE WHEN r2.name IN ('Project Manager','Branch Manager') THEN u3.id END
       FROM users u3 JOIN roles r2 ON r2.id=u3.role_id
       WHERE u3.id=(SELECT u4.manager_id FROM users u4 WHERE u4.id=c.team_lead_id)),
    (SELECT u5.id FROM users u5 JOIN roles r3 ON r3.id=u5.role_id
       WHERE r3.name IN ('Project Manager','Branch Manager')
         AND u5.branch_id=c.assigned_branch_id AND u5.is_active=1
       ORDER BY u5.id LIMIT 1)
  )
  FROM clients c WHERE c.id=payments.client_id
)
WHERE revenue_pm_id IS NULL;
