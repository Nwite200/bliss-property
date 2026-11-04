-- Phase 5: payment management, virtual accounts, receipts, installments
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id INTEGER NOT NULL,
  property_id INTEGER,
  transaction_ref TEXT NOT NULL,
  amount REAL NOT NULL,
  currency TEXT NOT NULL DEFAULT 'NGN',
  method TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  gateway_purchase_id TEXT,
  provider_ref TEXT,
  verified_at TEXT,
  verified_by INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  metadata TEXT,
  FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE,
  FOREIGN KEY (property_id) REFERENCES properties(id),
  FOREIGN KEY (verified_by) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_payments_client ON payments(client_id);
CREATE INDEX IF NOT EXISTS idx_payments_status ON payments(status);
CREATE INDEX IF NOT EXISTS idx_payments_verified ON payments(verified_at);

CREATE TABLE IF NOT EXISTS receipts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  payment_id INTEGER NOT NULL UNIQUE,
  client_id INTEGER NOT NULL,
  receipt_ref TEXT NOT NULL UNIQUE,
  r2_key TEXT,
  amount REAL NOT NULL,
  currency TEXT NOT NULL DEFAULT 'NGN',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (payment_id) REFERENCES payments(id) ON DELETE CASCADE,
  FOREIGN KEY (client_id) REFERENCES clients(id)
);

CREATE TABLE IF NOT EXISTS payment_schedules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id INTEGER NOT NULL,
  property_id INTEGER,
  total_amount REAL NOT NULL,
  deposit_amount REAL NOT NULL DEFAULT 0,
  installment_amount REAL NOT NULL,
  frequency_days INTEGER NOT NULL,
  next_due_date TEXT NOT NULL,
  created_by INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE,
  FOREIGN KEY (property_id) REFERENCES properties(id),
  FOREIGN KEY (created_by) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_schedules_client ON payment_schedules(client_id);

-- Note: no installment schedule is seeded here. Schedules are only created by
-- authorised staff through the installments API and are recorded in
-- payment_schedule_history. Clients without a plan see the "not configured" message.
