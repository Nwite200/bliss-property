-- Manual rollback for 0025_login_lockout_alerts_backup.sql. Do not apply automatically.
PRAGMA foreign_keys = ON;

DROP INDEX IF EXISTS idx_backup_runs_status;
DROP TABLE IF EXISTS backup_runs;
DROP INDEX IF EXISTS idx_system_alerts_open;
DROP TABLE IF EXISTS system_alerts;
DROP INDEX IF EXISTS idx_login_lockouts_user;
DROP INDEX IF EXISTS idx_login_lockouts_locked;
DROP TABLE IF EXISTS login_lockouts;
