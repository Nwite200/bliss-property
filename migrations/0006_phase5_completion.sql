-- Phase 5 completion: schedules lifecycle, webhook idempotency, notification delivery
PRAGMA foreign_keys = ON;

-- 1. Installment schedule lifecycle + authoritative integer kobo amounts
ALTER TABLE payment_schedules ADD COLUMN status TEXT NOT NULL DEFAULT 'active';
ALTER TABLE payment_schedules ADD COLUMN notes TEXT;
ALTER TABLE payment_schedules ADD COLUMN updated_at TEXT;
ALTER TABLE payment_schedules ADD COLUMN total_kobo INTEGER NOT NULL DEFAULT 0;
ALTER TABLE payment_schedules ADD COLUMN deposit_kobo INTEGER NOT NULL DEFAULT 0;
ALTER TABLE payment_schedules ADD COLUMN installment_kobo INTEGER NOT NULL DEFAULT 0;

UPDATE payment_schedules
SET total_kobo = CAST(ROUND(total_amount * 100) AS INTEGER),
    deposit_kobo = CAST(ROUND(deposit_amount * 100) AS INTEGER),
    installment_kobo = CAST(ROUND(installment_amount * 100) AS INTEGER),
    updated_at = created_at
WHERE total_kobo = 0;

CREATE INDEX IF NOT EXISTS idx_schedules_status ON payment_schedules(status);

-- Immutable-style schedule change history (create / update / cancel)
CREATE TABLE IF NOT EXISTS payment_schedule_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  schedule_id INTEGER NOT NULL,
  action TEXT NOT NULL, -- 'create' | 'update' | 'cancel'
  previous_json TEXT,
  new_json TEXT,
  reason TEXT,
  changed_by INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (schedule_id) REFERENCES payment_schedules(id) ON DELETE CASCADE,
  FOREIGN KEY (changed_by) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_schedule_history_schedule ON payment_schedule_history(schedule_id);

-- 2. Webhook idempotency and reconciliation trail
CREATE TABLE IF NOT EXISTS webhook_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  provider TEXT NOT NULL DEFAULT 'wema_alat',
  event_id TEXT NOT NULL UNIQUE,
  event_type TEXT,
  transaction_ref TEXT,
  payload TEXT,
  result TEXT NOT NULL DEFAULT 'received', -- received | verified | unmatched | amount_mismatch | duplicate | rejected
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  processed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_webhook_tx ON webhook_events(transaction_ref);

-- 3. Notification delivery trail (email / WhatsApp / in-app providers stay configurable)
CREATE TABLE IF NOT EXISTS notification_deliveries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  notification_id INTEGER,
  channel TEXT NOT NULL, -- 'in_app' | 'email' | 'whatsapp'
  provider TEXT NOT NULL DEFAULT 'pending',
  status TEXT NOT NULL DEFAULT 'queued', -- queued | sent | skipped | failed
  detail TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (notification_id) REFERENCES notifications(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_deliveries_notification ON notification_deliveries(notification_id);

-- Deduplication for scheduled reminders (upcoming / overdue)
CREATE TABLE IF NOT EXISTS notification_dedupe (
  dedupe_key TEXT PRIMARY KEY,
  notification_id INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
