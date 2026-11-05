-- Phase 16: automatic commission generation state and failure retry tracking.
PRAGMA foreign_keys = ON;

ALTER TABLE payments ADD COLUMN commission_state TEXT NOT NULL DEFAULT 'pending';
ALTER TABLE payments ADD COLUMN commission_processed_at TEXT;
ALTER TABLE payments ADD COLUMN commission_error TEXT;

CREATE INDEX IF NOT EXISTS idx_payments_commission_state ON payments(commission_state, status, payment_mode);

CREATE TABLE IF NOT EXISTS commission_generation_failures (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  payment_id INTEGER NOT NULL UNIQUE,
  client_id INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 1,
  last_error TEXT,
  next_retry_at TEXT,
  resolved_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (payment_id) REFERENCES payments(id) ON DELETE CASCADE,
  FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_commission_failures_open ON commission_generation_failures(resolved_at, next_retry_at);
