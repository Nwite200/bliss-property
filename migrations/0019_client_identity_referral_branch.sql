-- Phase 15: client identity (KYC), branch selection and virtual-account readiness.
-- Identity numbers are stored as a hash plus a masked display value; raw
-- NIN/passport/licence values and BVNs are never persisted by this application.
PRAGMA foreign_keys = ON;

ALTER TABLE clients ADD COLUMN identity_type TEXT;
ALTER TABLE clients ADD COLUMN identity_number_masked TEXT;
ALTER TABLE clients ADD COLUMN identity_number_last4 TEXT;
ALTER TABLE clients ADD COLUMN identity_number_hash TEXT;
ALTER TABLE clients ADD COLUMN bvn_last4 TEXT;
ALTER TABLE clients ADD COLUMN kyc_status TEXT NOT NULL DEFAULT 'pending';
ALTER TABLE clients ADD COLUMN kyc_submitted_at TEXT;
ALTER TABLE clients ADD COLUMN kyc_reviewed_by INTEGER REFERENCES users(id);
ALTER TABLE clients ADD COLUMN kyc_reviewed_at TEXT;
ALTER TABLE clients ADD COLUMN kyc_notes TEXT;

CREATE INDEX IF NOT EXISTS idx_clients_kyc_status ON clients(kyc_status);

-- Every client is expected to have a dedicated virtual account. The provider
-- wallet row already tracks provisioning state; this index makes the onboarding
-- readiness query cheap.
CREATE INDEX IF NOT EXISTS idx_static_wallets_client_status ON client_static_wallets(client_id, status);
