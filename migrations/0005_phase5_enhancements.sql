-- Phase 5 Enhancements: Client user link, notifications, virtual accounts, banking provider config, financial adjustments, integer kobo
PRAGMA foreign_keys = ON;

-- 1. Client user link (associates a login user with client record)
ALTER TABLE clients ADD COLUMN user_id INTEGER REFERENCES users(id);

-- 2. Add amount_kobo and is_demo to payments
ALTER TABLE payments ADD COLUMN amount_kobo INTEGER DEFAULT 0;
ALTER TABLE payments ADD COLUMN is_demo INTEGER DEFAULT 0;

-- Ensure transaction_ref is unique to prevent duplicate transactions
CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_tx_ref ON payments(transaction_ref);

-- 3. In-app notifications table
CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  client_id INTEGER,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  is_read INTEGER NOT NULL DEFAULT 0,
  metadata TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_client ON notifications(client_id);
CREATE INDEX IF NOT EXISTS idx_notifications_read ON notifications(is_read);

-- 4. Banking Provider Configurations (ALAT by Wema Bank, etc.)
CREATE TABLE IF NOT EXISTS provider_configs (
  provider_key TEXT PRIMARY KEY,
  provider_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'Not configured', -- 'Not configured', 'Awaiting onboarding', 'Awaiting credentials', 'Configured', 'Active'
  webhook_secret TEXT,
  environment TEXT NOT NULL DEFAULT 'sandbox',
  config_json TEXT,
  updated_by INTEGER,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (updated_by) REFERENCES users(id)
);

-- Seed ALAT by Wema Bank placeholder config
INSERT OR IGNORE INTO provider_configs (provider_key, provider_name, status, environment, config_json)
VALUES (
  'wema_alat',
  'ALAT by Wema Bank',
  'Not configured',
  'sandbox',
  '{"merchant_id":"","api_key":"","webhook_url":"/api/webhooks/wema-alat","reconciliation_enabled":false}'
);

-- 5. Virtual Accounts (only populated when genuinely supplied by official provider)
CREATE TABLE IF NOT EXISTS virtual_accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id INTEGER NOT NULL UNIQUE,
  provider TEXT NOT NULL DEFAULT 'wema_alat',
  bank_name TEXT NOT NULL DEFAULT 'Wema Bank',
  account_name TEXT,
  account_number TEXT,
  account_status TEXT NOT NULL DEFAULT 'pending', -- 'pending', 'active', 'suspended'
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_va_client ON virtual_accounts(client_id);

-- 6. Financial adjustments / Reversals (immutable financial event trail)
CREATE TABLE IF NOT EXISTS financial_adjustments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  payment_id INTEGER NOT NULL,
  adjustment_type TEXT NOT NULL, -- 'reversal', 'refund', 'correction'
  amount_kobo INTEGER NOT NULL,
  reason TEXT NOT NULL,
  authorized_by INTEGER NOT NULL,
  metadata TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (payment_id) REFERENCES payments(id),
  FOREIGN KEY (authorized_by) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_adjustments_payment ON financial_adjustments(payment_id);

-- 7. Add receipt columns for financial integrity and demo labeling
ALTER TABLE receipts ADD COLUMN amount_kobo INTEGER DEFAULT 0;
ALTER TABLE receipts ADD COLUMN remaining_balance_kobo INTEGER DEFAULT 0;
ALTER TABLE receipts ADD COLUMN is_demo INTEGER DEFAULT 0;
