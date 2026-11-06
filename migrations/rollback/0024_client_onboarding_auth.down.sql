-- Manual rollback for 0024_client_onboarding_auth.sql. Do not apply automatically.
PRAGMA foreign_keys = ON;

DROP INDEX IF EXISTS idx_client_reset_active;
DROP INDEX IF EXISTS idx_client_reset_phone;
DROP INDEX IF EXISTS idx_client_reset_user;
DROP TABLE IF EXISTS client_password_reset_codes;

DELETE FROM sms_templates WHERE template_key IN (
  'client_password_reset_code',
  'client_password_reset_completed',
  'client_password_reset_notice',
  'client_password_reset_temp'
);

DROP INDEX IF EXISTS idx_users_phone_e164;
ALTER TABLE users DROP COLUMN phone_changed_at;
ALTER TABLE users DROP COLUMN phone_verified_at;
ALTER TABLE users DROP COLUMN phone_e164;
