-- Phase 6: staff dashboards, team management, lead pipeline, performance analytics and activity centre
PRAGMA foreign_keys = ON;

-- 1. Staff profile / account lifecycle support
ALTER TABLE users ADD COLUMN last_login_at TEXT;
ALTER TABLE users ADD COLUMN deactivated_at TEXT;

CREATE TABLE IF NOT EXISTS staff_profiles (
  user_id INTEGER PRIMARY KEY,
  phone_number TEXT,
  job_title TEXT,
  date_joined TEXT,
  notes TEXT,
  updated_by INTEGER,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (updated_by) REFERENCES users(id)
);

-- 2. Activity centre branch attribution. Existing audit rows are backfilled
-- from the actor's branch without deleting or rewriting history.
ALTER TABLE audit_logs ADD COLUMN branch_id INTEGER;
UPDATE audit_logs
SET branch_id = (
  SELECT u.branch_id FROM users u WHERE u.id = audit_logs.actor_user_id
)
WHERE branch_id IS NULL AND actor_user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_audit_branch ON audit_logs(branch_id);
CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_logs(action);

-- 3. Team lifecycle support (existing rows remain active)
ALTER TABLE teams ADD COLUMN is_active INTEGER NOT NULL DEFAULT 1;

-- 4. Lead pipeline and follow-up management
CREATE TABLE IF NOT EXISTS leads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lead_reference TEXT NOT NULL UNIQUE,
  full_name TEXT NOT NULL,
  phone_number TEXT NOT NULL,
  email_address TEXT,
  source TEXT,
  status TEXT NOT NULL DEFAULT 'New Lead',
  property_id INTEGER,
  assigned_marketer_id INTEGER,
  team_lead_id INTEGER,
  branch_id INTEGER NOT NULL,
  estimated_value_kobo INTEGER NOT NULL DEFAULT 0,
  notes TEXT,
  next_follow_up_date TEXT,
  last_contact_at TEXT,
  converted_client_id INTEGER,
  converted_at TEXT,
  created_by INTEGER NOT NULL,
  is_demo INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (property_id) REFERENCES properties(id),
  FOREIGN KEY (assigned_marketer_id) REFERENCES users(id),
  FOREIGN KEY (team_lead_id) REFERENCES users(id),
  FOREIGN KEY (branch_id) REFERENCES branches(id),
  FOREIGN KEY (converted_client_id) REFERENCES clients(id),
  FOREIGN KEY (created_by) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_leads_branch ON leads(branch_id);
CREATE INDEX IF NOT EXISTS idx_leads_status ON leads(status);
CREATE INDEX IF NOT EXISTS idx_leads_marketer ON leads(assigned_marketer_id);
CREATE INDEX IF NOT EXISTS idx_leads_team_lead ON leads(team_lead_id);
CREATE INDEX IF NOT EXISTS idx_leads_follow_up ON leads(next_follow_up_date);
CREATE INDEX IF NOT EXISTS idx_leads_created ON leads(created_at);

CREATE TABLE IF NOT EXISTS lead_follow_ups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lead_id INTEGER NOT NULL,
  staff_id INTEGER NOT NULL,
  note TEXT NOT NULL,
  channel TEXT,
  outcome TEXT,
  follow_up_date TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE CASCADE,
  FOREIGN KEY (staff_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_lead_follow_ups_lead ON lead_follow_ups(lead_id);
CREATE INDEX IF NOT EXISTS idx_lead_follow_ups_staff ON lead_follow_ups(staff_id);
CREATE INDEX IF NOT EXISTS idx_lead_follow_ups_date ON lead_follow_ups(follow_up_date);
