-- Phase 15: ALATPay documented webhook validation, transaction monitoring,
-- static wallets and test/live separation.
PRAGMA foreign_keys = ON;

ALTER TABLE payments ADD COLUMN payment_mode TEXT NOT NULL DEFAULT 'live';
ALTER TABLE payments ADD COLUMN provider_account_number TEXT;
ALTER TABLE payments ADD COLUMN provider_wallet_id INTEGER;

ALTER TABLE virtual_accounts ADD COLUMN payment_mode TEXT NOT NULL DEFAULT 'live';
ALTER TABLE webhook_events ADD COLUMN payment_mode TEXT;

CREATE INDEX IF NOT EXISTS idx_payments_mode_status ON payments(payment_mode, status);
CREATE INDEX IF NOT EXISTS idx_payments_provider_account ON payments(provider, provider_account_number);

CREATE TABLE IF NOT EXISTS client_static_wallets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id INTEGER NOT NULL UNIQUE,
  provider TEXT NOT NULL DEFAULT 'alatpay',
  payment_mode TEXT NOT NULL DEFAULT 'test',
  business_id TEXT,
  wallet_type INTEGER NOT NULL DEFAULT 1,
  wallet_reference TEXT,
  otp_tracking_id TEXT,
  account_number TEXT,
  account_name TEXT,
  bank_name TEXT,
  status TEXT NOT NULL DEFAULT 'otp_pending', -- otp_pending | active | failed | disabled
  provider_status TEXT,
  metadata_json TEXT,
  created_by INTEGER,
  updated_by INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE,
  FOREIGN KEY (created_by) REFERENCES users(id),
  FOREIGN KEY (updated_by) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_static_wallets_mode ON client_static_wallets(payment_mode, status);
CREATE INDEX IF NOT EXISTS idx_static_wallets_account ON client_static_wallets(account_number);
