-- Phase 26: configurable referral commission plans with cumulative tiered cap
-- and percentage-of-verified-payments rule types. Additive only.
PRAGMA foreign_keys = ON;

ALTER TABLE commission_plans ADD COLUMN plan_family TEXT NOT NULL DEFAULT 'standard';
ALTER TABLE commission_plans ADD COLUMN sale_type TEXT;
ALTER TABLE commission_plans ADD COLUMN min_duration_months INTEGER;
ALTER TABLE commission_plans ADD COLUMN max_duration_months INTEGER;
ALTER TABLE commission_plans ADD COLUMN outright_applies INTEGER NOT NULL DEFAULT 0;

ALTER TABLE commission_plan_rules ADD COLUMN rule_type TEXT NOT NULL DEFAULT 'percentage';
ALTER TABLE commission_plan_rules ADD COLUMN stage_amount_kobo INTEGER NOT NULL DEFAULT 0;
ALTER TABLE commission_plan_rules ADD COLUMN stage1_cap_kobo INTEGER NOT NULL DEFAULT 0;
ALTER TABLE commission_plan_rules ADD COLUMN stage2_cap_kobo INTEGER NOT NULL DEFAULT 0;
ALTER TABLE commission_plan_rules ADD COLUMN max_cap_kobo INTEGER NOT NULL DEFAULT 0;

ALTER TABLE commission_plan_versions ADD COLUMN plan_family TEXT NOT NULL DEFAULT 'standard';
ALTER TABLE commission_plan_versions ADD COLUMN sale_type TEXT;
ALTER TABLE commission_plan_versions ADD COLUMN min_duration_months INTEGER;
ALTER TABLE commission_plan_versions ADD COLUMN max_duration_months INTEGER;
ALTER TABLE commission_plan_versions ADD COLUMN outright_applies INTEGER NOT NULL DEFAULT 0;

ALTER TABLE referral_commission_accounts ADD COLUMN plan_version_no INTEGER;
ALTER TABLE referral_commission_accounts ADD COLUMN rule_snapshot_json TEXT;
ALTER TABLE referral_commission_accounts ADD COLUMN carry_forward_kobo INTEGER NOT NULL DEFAULT 0;

-- Seed the two owner-approved structures for the Marketer role only. These
-- inserts are skipped on a completely fresh database with no users yet; the
-- application ensures the plans exist after the owner account is created.
INSERT INTO commission_plans
  (name, description, calculation_basis, effective_from, effective_to,
   approval_required, separation_of_duties, is_active, created_by,
   commissionable_mode, commissionable_first_months, commissionable_percent_bps,
   commissionable_cap_kobo, current_version_no, plan_family, sale_type,
   min_duration_months, max_duration_months, outright_applies)
SELECT
  'Referral Long-Term (Marketer)',
  'Marketer referral commission for plans longer than 8 months: 20,000 on the first 60,000, 15,000 on the next 60,000, capped at 35,000.',
  'referral_cumulative_tiered', date('now'), NULL,
  0, 0, 1,
  (SELECT id FROM users ORDER BY CASE WHEN role_id IN (SELECT id FROM roles WHERE name IN ('Managing Director','Super Admin')) THEN 0 ELSE 1 END, id LIMIT 1),
  'full', 2, 10000, 0, 1, 'referral', 'Referral', 9, NULL, 0
WHERE EXISTS (SELECT 1 FROM users)
  AND NOT EXISTS (
    SELECT 1 FROM commission_plans WHERE plan_family='referral' AND min_duration_months=9
  );

INSERT INTO commission_plans
  (name, description, calculation_basis, effective_from, effective_to,
   approval_required, separation_of_duties, is_active, created_by,
   commissionable_mode, commissionable_first_months, commissionable_percent_bps,
   commissionable_cap_kobo, current_version_no, plan_family, sale_type,
   min_duration_months, max_duration_months, outright_applies)
SELECT
  'Referral Short-Term and Outright (Marketer)',
  'Marketer referral commission for plans of 7 months or less and outright purchases: 10% of each verified payment.',
  'referral_percentage', date('now'), NULL,
  0, 0, 1,
  (SELECT id FROM users ORDER BY CASE WHEN role_id IN (SELECT id FROM roles WHERE name IN ('Managing Director','Super Admin')) THEN 0 ELSE 1 END, id LIMIT 1),
  'full', 2, 10000, 0, 1, 'referral', 'Referral', 0, 7, 1
WHERE EXISTS (SELECT 1 FROM users)
  AND NOT EXISTS (
    SELECT 1 FROM commission_plans WHERE plan_family='referral' AND max_duration_months=7 AND outright_applies=1
  );

INSERT INTO commission_plan_rules
  (plan_id, role_name, rate_bps, fixed_amount_kobo, sales_type, is_active,
   rule_type, stage_amount_kobo, stage1_cap_kobo, stage2_cap_kobo, max_cap_kobo)
SELECT p.id, 'Marketer', 0, 0, 'Referral', 1,
  'cumulative_tiered_cap', 6000000, 2000000, 1500000, 3500000
FROM commission_plans p
WHERE p.plan_family='referral' AND p.min_duration_months=9
  AND NOT EXISTS (SELECT 1 FROM commission_plan_rules r WHERE r.plan_id=p.id);

INSERT INTO commission_plan_rules
  (plan_id, role_name, rate_bps, fixed_amount_kobo, sales_type, is_active,
   rule_type, stage_amount_kobo, stage1_cap_kobo, stage2_cap_kobo, max_cap_kobo)
SELECT p.id, 'Marketer', 1000, 0, 'Referral', 1,
  'percentage', 0, 0, 0, 0
FROM commission_plans p
WHERE p.plan_family='referral' AND p.max_duration_months=7 AND p.outright_applies=1
  AND NOT EXISTS (SELECT 1 FROM commission_plan_rules r WHERE r.plan_id=p.id);

INSERT INTO commission_plan_versions
  (plan_id, version_no, name, description, calculation_basis, effective_from, effective_to,
   commissionable_mode, commissionable_first_months, commissionable_percent_bps,
   commissionable_cap_kobo, rules_json, change_reason, created_by,
   plan_family, sale_type, min_duration_months, max_duration_months, outright_applies)
SELECT p.id, 1, p.name, p.description, p.calculation_basis, p.effective_from, p.effective_to,
  p.commissionable_mode, p.commissionable_first_months, p.commissionable_percent_bps,
  p.commissionable_cap_kobo, '[]', 'Initial seeded referral plan', p.created_by,
  p.plan_family, p.sale_type, p.min_duration_months, p.max_duration_months, p.outright_applies
FROM commission_plans p
WHERE p.plan_family='referral'
  AND NOT EXISTS (SELECT 1 FROM commission_plan_versions v WHERE v.plan_id=p.id);
