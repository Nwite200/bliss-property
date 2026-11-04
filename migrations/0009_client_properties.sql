-- Phase 7.1: multiple client property allocations and per-property payment progress
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS client_properties (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id INTEGER NOT NULL,
  property_id INTEGER NOT NULL,
  agreed_purchase_price INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'Active',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE,
  FOREIGN KEY (property_id) REFERENCES properties(id),
  UNIQUE (client_id, property_id)
);

CREATE INDEX IF NOT EXISTS idx_client_properties_client ON client_properties(client_id);
CREATE INDEX IF NOT EXISTS idx_client_properties_property ON client_properties(property_id);

-- Preserve every existing primary client/property allocation.
INSERT OR IGNORE INTO client_properties (client_id, property_id, agreed_purchase_price, status)
SELECT id, interested_property_id, COALESCE(agreed_purchase_price, 0), COALESCE(status, 'Active')
FROM clients
WHERE interested_property_id IS NOT NULL
  AND is_deleted = 0;
