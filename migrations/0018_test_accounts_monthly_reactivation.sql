-- Phase 17: test-account lifecycle and monthly marketer reactivation.
PRAGMA foreign_keys = ON;

ALTER TABLE users ADD COLUMN is_test INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN test_expires_at TEXT;
ALTER TABLE users ADD COLUMN access_valid_until TEXT;
ALTER TABLE users ADD COLUMN access_lapsed_at TEXT;
ALTER TABLE users ADD COLUMN reactivated_at TEXT;
ALTER TABLE users ADD COLUMN reactivated_by INTEGER REFERENCES users(id);

CREATE INDEX IF NOT EXISTS idx_users_test_expiry ON users(is_test, test_expires_at, is_active);
CREATE INDEX IF NOT EXISTS idx_users_access_validity ON users(access_valid_until, is_active);

CREATE TABLE IF NOT EXISTS role_access_settings (
  role_name TEXT PRIMARY KEY,
  monthly_reactivation_enabled INTEGER NOT NULL DEFAULT 0,
  updated_by INTEGER,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (updated_by) REFERENCES users(id)
);

INSERT OR IGNORE INTO role_access_settings (role_name, monthly_reactivation_enabled) VALUES
  ('Marketer', 1),
  ('Team Lead', 0),
  ('Branch Manager', 0),
  ('Project Manager', 0),
  ('Finance Officer', 0),
  ('Head Accountant', 0),
  ('Customer Care', 0);

-- Existing marketers become valid until the end of the current month.
UPDATE users SET access_valid_until = date('now','start of month','+1 month','-1 day')
WHERE access_valid_until IS NULL
  AND role_id IN (SELECT id FROM roles WHERE name='Marketer');
