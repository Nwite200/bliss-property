-- Phase 4: client registration, management and staff assignment
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS clients (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_reference TEXT NOT NULL UNIQUE,
  full_name TEXT NOT NULL,
  phone_number TEXT NOT NULL,
  email_address TEXT,
  residential_address TEXT,
  state TEXT,
  city TEXT,
  next_of_kin TEXT,
  notes TEXT,
  preferred_channel TEXT,
  status TEXT NOT NULL DEFAULT 'Prospect',
  assigned_branch_id INTEGER,
  created_by INTEGER NOT NULL,
  original_marketer_id INTEGER NOT NULL,
  team_lead_id INTEGER,
  agreed_purchase_price INTEGER,
  interested_property_id INTEGER,
  is_deleted INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at TEXT,
  FOREIGN KEY (assigned_branch_id) REFERENCES branches(id),
  FOREIGN KEY (created_by) REFERENCES users(id),
  FOREIGN KEY (original_marketer_id) REFERENCES users(id),
  FOREIGN KEY (team_lead_id) REFERENCES users(id),
  FOREIGN KEY (interested_property_id) REFERENCES properties(id)
);

CREATE TABLE IF NOT EXISTS client_assignments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id INTEGER NOT NULL,
  relationship_manager_id INTEGER NOT NULL,
  branch_id INTEGER NOT NULL,
  team_lead_id INTEGER,
  assigned_at TEXT NOT NULL DEFAULT (datetime('now')),
  assigned_by INTEGER,
  is_primary INTEGER NOT NULL DEFAULT 1,
  FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE,
  FOREIGN KEY (relationship_manager_id) REFERENCES users(id),
  FOREIGN KEY (branch_id) REFERENCES branches(id),
  FOREIGN KEY (team_lead_id) REFERENCES users(id),
  FOREIGN KEY (assigned_by) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS client_assignment_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id INTEGER NOT NULL,
  previous_manager_id INTEGER,
  new_manager_id INTEGER,
  previous_branch_id INTEGER,
  new_branch_id INTEGER,
  previous_team_lead_id INTEGER,
  new_team_lead_id INTEGER,
  authorized_by INTEGER,
  reason TEXT,
  changed_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE,
  FOREIGN KEY (previous_manager_id) REFERENCES users(id),
  FOREIGN KEY (new_manager_id) REFERENCES users(id),
  FOREIGN KEY (previous_branch_id) REFERENCES branches(id),
  FOREIGN KEY (new_branch_id) REFERENCES branches(id),
  FOREIGN KEY (previous_team_lead_id) REFERENCES users(id),
  FOREIGN KEY (new_team_lead_id) REFERENCES users(id),
  FOREIGN KEY (authorized_by) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS client_status_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id INTEGER NOT NULL,
  old_status TEXT,
  new_status TEXT NOT NULL,
  changed_by INTEGER,
  changed_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE,
  FOREIGN KEY (changed_by) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS client_notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id INTEGER NOT NULL,
  note TEXT NOT NULL,
  created_by INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE,
  FOREIGN KEY (created_by) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_clients_branch ON clients(assigned_branch_id);
CREATE INDEX IF NOT EXISTS idx_clients_created_by ON clients(created_by);
CREATE INDEX IF NOT EXISTS idx_clients_original_marketer ON clients(original_marketer_id);
CREATE INDEX IF NOT EXISTS idx_clients_status ON clients(status);
CREATE INDEX IF NOT EXISTS idx_clients_reference ON clients(client_reference);
CREATE INDEX IF NOT EXISTS idx_client_assignments_client ON client_assignments(client_id);
CREATE INDEX IF NOT EXISTS idx_client_assignment_history_client ON client_assignment_history(client_id);
CREATE INDEX IF NOT EXISTS idx_client_status_history_client ON client_status_history(client_id);
