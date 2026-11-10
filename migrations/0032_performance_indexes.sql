-- Phase 32: query indexes for the measured dashboard read paths.
-- Additive only; no schema or API response changes.

PRAGMA foreign_keys = ON;

CREATE INDEX IF NOT EXISTS idx_clients_team_lead_deleted
  ON clients(team_lead_id, is_deleted);
CREATE INDEX IF NOT EXISTS idx_clients_branch_deleted
  ON clients(assigned_branch_id, is_deleted);
CREATE INDEX IF NOT EXISTS idx_payments_status_scope_date
  ON payments(status, is_demo, currency, verified_at);
CREATE INDEX IF NOT EXISTS idx_payments_branch_status_date
  ON payments(revenue_branch_id, status, verified_at);
CREATE INDEX IF NOT EXISTS idx_notifications_user_created
  ON notifications(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_notifications_client_created
  ON notifications(client_id, created_at);
CREATE INDEX IF NOT EXISTS idx_leads_branch_status
  ON leads(branch_id, status);
