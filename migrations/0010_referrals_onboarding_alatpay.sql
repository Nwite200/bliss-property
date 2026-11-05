-- Phase 9: referrals, enhanced client onboarding and ALATPay virtual-account metadata
PRAGMA foreign_keys = ON;

-- Staff referral identity. Every staff member receives one stable code.
ALTER TABLE users ADD COLUMN referral_code TEXT;
UPDATE users SET referral_code = 'BL-' || printf('%06d', id) WHERE referral_code IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_referral_code ON users(referral_code);

-- Enhanced client onboarding and referral attribution.
ALTER TABLE clients ADD COLUMN alternate_phone TEXT;
ALTER TABLE clients ADD COLUMN next_of_kin_name TEXT;
ALTER TABLE clients ADD COLUMN next_of_kin_phone TEXT;
ALTER TABLE clients ADD COLUMN next_of_kin_relationship TEXT;
ALTER TABLE clients ADD COLUMN next_of_kin_address TEXT;
ALTER TABLE clients ADD COLUMN referral_code_used TEXT;
ALTER TABLE clients ADD COLUMN referred_by_staff_id INTEGER REFERENCES users(id);
CREATE INDEX IF NOT EXISTS idx_clients_referrer ON clients(referred_by_staff_id);

-- ALATPay dynamic virtual-account metadata. The provider may issue a fresh
-- account per payment; the virtual_accounts row holds the latest account.
ALTER TABLE virtual_accounts ADD COLUMN provider_reference TEXT;
ALTER TABLE virtual_accounts ADD COLUMN transaction_id TEXT;
ALTER TABLE virtual_accounts ADD COLUMN order_id TEXT;
ALTER TABLE virtual_accounts ADD COLUMN expires_at TEXT;
ALTER TABLE virtual_accounts ADD COLUMN amount_kobo INTEGER DEFAULT 0;
ALTER TABLE virtual_accounts ADD COLUMN metadata TEXT;
ALTER TABLE virtual_accounts ADD COLUMN updated_by INTEGER REFERENCES users(id);
CREATE INDEX IF NOT EXISTS idx_va_order ON virtual_accounts(order_id);
CREATE INDEX IF NOT EXISTS idx_va_transaction ON virtual_accounts(transaction_id);

-- ALATPay provider status. Credentials are Worker secrets, not stored here.
INSERT OR IGNORE INTO provider_configs (provider_key, provider_name, status, environment, config_json)
VALUES (
  'alatpay',
  'ALATPay by Wema Bank',
  'Awaiting business ID',
  'production',
  '{"base_url":"https://apibox.alatpay.ng","business_id":"","webhook_url":"/api/webhooks/alatpay","virtual_account_mode":"dynamic"}'
);
