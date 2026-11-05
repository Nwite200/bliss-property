-- Phase 18: versioned Terms & Conditions and client acceptance records.
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS terms_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  version_no INTEGER NOT NULL UNIQUE,
  title TEXT NOT NULL,
  body_text TEXT NOT NULL,
  document_r2_key TEXT,
  document_filename TEXT,
  document_content_type TEXT,
  is_active INTEGER NOT NULL DEFAULT 0,
  created_by INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_terms_active ON terms_versions(is_active, version_no);
CREATE INDEX IF NOT EXISTS idx_terms_created ON terms_versions(created_at);

CREATE TABLE IF NOT EXISTS terms_acceptances (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  terms_version_id INTEGER NOT NULL,
  user_id INTEGER,
  client_id INTEGER,
  accepted_at TEXT NOT NULL DEFAULT (datetime('now')),
  ip_address TEXT,
  user_agent TEXT,
  FOREIGN KEY (terms_version_id) REFERENCES terms_versions(id) ON DELETE RESTRICT,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_terms_acceptance_version ON terms_acceptances(terms_version_id, accepted_at);
CREATE INDEX IF NOT EXISTS idx_terms_acceptance_client ON terms_acceptances(client_id);

INSERT OR IGNORE INTO terms_versions
  (version_no, title, body_text, is_active)
VALUES (
  1,
  'Terms and Conditions',
  'These Terms and Conditions govern the use of the Bliss Legacy Limited client portal and the creation of a client account.

1. Account information
You confirm that the information you provide during registration is accurate, current and complete. You must promptly update your contact details if they change.

2. Identity verification
You consent to identity and KYC checks, including verification of the identity details and BVN you provide. Identity numbers and BVNs are handled securely and are never displayed in full.

3. Property enquiries and payments
Submitting an enquiry or creating an account does not by itself create a property allocation, guarantee a price, or reserve a property. Property terms, payment plans and allocations are only confirmed in the formal documents issued by Bliss Legacy Limited.

4. Payments and virtual accounts
Payments must be made through the verified channels shown in your client portal. A dedicated virtual account may be created with our banking partner. You are responsible for confirming the account details before sending money.

5. Data protection
We process your personal data to manage your account, property interest, payments and regulatory obligations. We do not sell your personal data.

6. Communications
You consent to receive service messages about your account, payments, receipts, property information and verification by SMS, email or in-app notification.

7. Acceptance
By ticking the acceptance box and creating an account, you confirm that you have read, understood and accepted these Terms and Conditions.',
  1
);
