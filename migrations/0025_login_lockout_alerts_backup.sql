-- Phase 25: login lockouts, system alerts and scheduled D1 backups. Additive only.
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS login_lockouts (
  scope TEXT NOT NULL,              -- account | ip
  lock_key TEXT NOT NULL,
  user_id INTEGER,
  failures INTEGER NOT NULL DEFAULT 0,
  first_failure_at TEXT,
  last_failure_at TEXT,
  locked_until TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (scope, lock_key),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_login_lockouts_locked
  ON login_lockouts(scope, locked_until);
CREATE INDEX IF NOT EXISTS idx_login_lockouts_user
  ON login_lockouts(user_id, locked_until);

CREATE TABLE IF NOT EXISTS system_alerts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  alert_type TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'warning',
  dedupe_key TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  message TEXT,
  metadata TEXT,
  occurrences INTEGER NOT NULL DEFAULT 1,
  first_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_notified_at TEXT,
  acknowledged_by INTEGER,
  acknowledged_at TEXT,
  resolved_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (acknowledged_by) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_system_alerts_open
  ON system_alerts(resolved_at, last_seen_at);

CREATE TABLE IF NOT EXISTS backup_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  finished_at TEXT,
  status TEXT NOT NULL DEFAULT 'running', -- running | success | failed
  r2_key TEXT,
  size_bytes INTEGER NOT NULL DEFAULT 0,
  table_counts TEXT,
  error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_backup_runs_status
  ON backup_runs(status, started_at);
