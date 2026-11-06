-- Phase 19: property listing workflow, demo/internal-test controls and app settings.
PRAGMA foreign_keys = ON;

ALTER TABLE properties ADD COLUMN is_demo INTEGER NOT NULL DEFAULT 0;
ALTER TABLE properties ADD COLUMN is_internal_test INTEGER NOT NULL DEFAULT 0;
ALTER TABLE properties ADD COLUMN is_archived INTEGER NOT NULL DEFAULT 0;
ALTER TABLE properties ADD COLUMN workflow_status TEXT NOT NULL DEFAULT 'draft';
ALTER TABLE properties ADD COLUMN approved_by INTEGER REFERENCES users(id);
ALTER TABLE properties ADD COLUMN approved_at TEXT;
ALTER TABLE properties ADD COLUMN submitted_at TEXT;
ALTER TABLE properties ADD COLUMN archived_at TEXT;
ALTER TABLE properties ADD COLUMN available_units INTEGER;
ALTER TABLE properties ADD COLUMN total_units INTEGER;

UPDATE properties
SET workflow_status = CASE WHEN is_published=1 THEN 'published' ELSE 'draft' END;

ALTER TABLE property_payment_plans ADD COLUMN balance_difference_kobo INTEGER NOT NULL DEFAULT 0;
ALTER TABLE property_payment_plans ADD COLUMN first_payment_rule TEXT;

ALTER TABLE clients ADD COLUMN is_internal_test INTEGER NOT NULL DEFAULT 0;
ALTER TABLE clients ADD COLUMN is_archived INTEGER NOT NULL DEFAULT 0;

ALTER TABLE payments ADD COLUMN is_internal_test INTEGER NOT NULL DEFAULT 0;
ALTER TABLE payments ADD COLUMN is_archived INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_properties_workflow ON properties(workflow_status, is_archived);
CREATE INDEX IF NOT EXISTS idx_properties_test ON properties(is_internal_test, is_archived);
CREATE INDEX IF NOT EXISTS idx_properties_demo ON properties(is_demo, is_archived);
CREATE INDEX IF NOT EXISTS idx_clients_test ON clients(is_internal_test, is_archived);
CREATE INDEX IF NOT EXISTS idx_payments_test ON payments(is_internal_test, is_archived);

CREATE TABLE IF NOT EXISTS app_settings (
  setting_key TEXT PRIMARY KEY,
  setting_value TEXT,
  updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT OR IGNORE INTO app_settings (setting_key, setting_value) VALUES
  ('branch_manager_listing_approval', '1'),
  ('hide_demo_properties', '1'),
  ('hide_all_test_data', '0'),
  ('site_config', '{"company_name":"Bliss Legacy Limited","tagline":"Your Future Begins With the Right Property.","phone":"0805 289 9920","whatsapp_number":"2349168630710","email":"hrblisslegacy@gmail.com","address":"102, Ihama Road, GRA, Benin City, close to Living Faith Church (Winners Church)","facebook":"https://blisslegacy.com","instagram":"","twitter":"","linkedin":"","branches":[{"name":"Head Office","city":"Benin City","state":"Edo State","type":"Corporate Headquarters","address":"102, Ihama Road, GRA, Benin City, close to Living Faith Church (Winners Church)","phone":"0805 289 9920","isHeadOffice":true},{"name":"Ikeja Branch","city":"Ikeja","state":"Lagos State","type":"Mainland Branch","address":"Plot 40, Adegbola Street, Anifowose, close to the Local Government","phone":"0805 289 9920","isHeadOffice":false},{"name":"Ajah Branch","city":"Ajah","state":"Lagos State","type":"Island & Lekki Corridor Branch","address":"Fladek Plaza, opposite Pump and Sell Bus Stop, Ado Road, Ajah","phone":"0805 289 9920","isHeadOffice":false},{"name":"Asaba Branch","city":"Asaba","state":"Delta State","type":"Delta State Regional Office","address":"Plot 2, Ikukaiwe Street, close to Christian Association of Nigeria (CAN) Building","phone":"0807 389 1911","isHeadOffice":false},{"name":"Ihama Branch","city":"Benin City","state":"Edo State","type":"GRA Branch","address":"102, Ihama Road, GRA, Benin City, close to Living Faith Church (Winners Church)","phone":"0807 389 3946","isHeadOffice":false},{"name":"Obakhavbaye Branch","city":"Benin City","state":"Edo State","type":"Commercial Office","address":"13, Obakhavbaye Street, off Oba Market Road, Benin City","phone":"0805 289 9920","isHeadOffice":false}]}');

-- A client created against an internal-test property is marked as test data.
CREATE TRIGGER IF NOT EXISTS trg_clients_internal_test_ai
AFTER INSERT ON clients
BEGIN
  UPDATE clients
  SET is_internal_test = COALESCE((
    SELECT CASE WHEN p.is_internal_test=1 THEN 1 ELSE 0 END
    FROM properties p WHERE p.id=NEW.interested_property_id
  ), 0)
  WHERE id=NEW.id;
END;

-- Payments inherit the internal-test flag from the client or property.
CREATE TRIGGER IF NOT EXISTS trg_payments_internal_test_ai
AFTER INSERT ON payments
BEGIN
  UPDATE payments
  SET is_internal_test = COALESCE((
    SELECT CASE WHEN c.is_internal_test=1 OR p.is_internal_test=1 THEN 1 ELSE 0 END
    FROM clients c LEFT JOIN properties p ON p.id=NEW.property_id
    WHERE c.id=NEW.client_id
  ), 0)
  WHERE id=NEW.id;
END;

