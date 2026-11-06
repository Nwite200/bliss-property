-- Phase 27: split short-term and outright referral plans, add outright
-- treatment, rule applicability and version snapshots. Additive only.
PRAGMA foreign_keys = ON;

ALTER TABLE commission_plan_rules ADD COLUMN applies_to TEXT NOT NULL DEFAULT 'all';
ALTER TABLE commission_plans ADD COLUMN outright_treatment TEXT NOT NULL DEFAULT 'flat';
ALTER TABLE commission_plan_versions ADD COLUMN outright_treatment TEXT NOT NULL DEFAULT 'flat';

UPDATE commission_plans
SET min_duration_months = 8
WHERE plan_family='referral' AND min_duration_months=9;

UPDATE commission_plan_versions
SET min_duration_months = 8
WHERE plan_id IN (SELECT id FROM commission_plans WHERE plan_family='referral')
  AND min_duration_months=9;

UPDATE commission_plan_rules
SET applies_to = CASE
  WHEN rule_type = 'cumulative_tiered_cap' THEN 'long_term'
  WHEN plan_id IN (SELECT id FROM commission_plans WHERE plan_family='referral' AND max_duration_months=7) THEN 'short_term'
  ELSE applies_to
END;

UPDATE commission_plans
SET name = 'Referral Short-Term (Marketer)',
    description = 'Marketer referral commission for plans of 7 months or less: 10% of each verified payment.',
    min_duration_months = 1,
    max_duration_months = 7,
    outright_applies = 0
WHERE plan_family='referral' AND max_duration_months=7 AND outright_applies=1;

UPDATE commission_plan_versions
SET name = 'Referral Short-Term (Marketer)',
    description = 'Marketer referral commission for plans of 7 months or less: 10% of each verified payment.',
    min_duration_months = 1,
    max_duration_months = 7,
    outright_applies = 0
WHERE plan_id IN (
  SELECT id FROM commission_plans WHERE plan_family='referral' AND max_duration_months=7 AND outright_applies=0
);

INSERT INTO commission_plans
  (name, description, calculation_basis, effective_from, effective_to,
   approval_required, separation_of_duties, is_active, created_by,
   commissionable_mode, commissionable_first_months, commissionable_percent_bps,
   commissionable_cap_kobo, current_version_no, plan_family, sale_type,
   min_duration_months, max_duration_months, outright_applies, outright_treatment)
SELECT
  'Referral Outright (Marketer)',
  'Marketer referral commission for outright purchases: 10% of verified payments by default. The owner may switch this plan to the two-stage rule.',
  'referral_percentage', date('now'), NULL,
  0, 0, 1,
  (SELECT id FROM users ORDER BY CASE WHEN role_id IN (SELECT id FROM roles WHERE name IN ('Managing Director','Super Admin')) THEN 0 ELSE 1 END, id LIMIT 1),
  'full', 2, 10000, 0, 1, 'referral', 'Referral', 0, 0, 1, 'flat'
WHERE EXISTS (SELECT 1 FROM users)
  AND NOT EXISTS (
    SELECT 1 FROM commission_plans WHERE plan_family='referral' AND outright_applies=1 AND max_duration_months=0
  );

INSERT INTO commission_plan_rules
  (plan_id, role_name, rate_bps, fixed_amount_kobo, sales_type, is_active,
   rule_type, stage_amount_kobo, stage1_cap_kobo, stage2_cap_kobo, max_cap_kobo, applies_to)
SELECT p.id, 'Marketer', 1000, 0, 'Referral', 1,
  'percentage', 0, 0, 0, 0, 'outright'
FROM commission_plans p
WHERE p.plan_family='referral' AND p.outright_applies=1 AND p.max_duration_months=0
  AND NOT EXISTS (SELECT 1 FROM commission_plan_rules r WHERE r.plan_id=p.id);

INSERT INTO commission_plan_versions
  (plan_id, version_no, name, description, calculation_basis, effective_from, effective_to,
   commissionable_mode, commissionable_first_months, commissionable_percent_bps,
   commissionable_cap_kobo, rules_json, change_reason, created_by,
   plan_family, sale_type, min_duration_months, max_duration_months, outright_applies, outright_treatment)
SELECT p.id, 1, p.name, p.description, p.calculation_basis, p.effective_from, p.effective_to,
  p.commissionable_mode, p.commissionable_first_months, p.commissionable_percent_bps,
  p.commissionable_cap_kobo, '[]', 'Initial seeded outright referral plan', p.created_by,
  p.plan_family, p.sale_type, p.min_duration_months, p.max_duration_months, p.outright_applies, p.outright_treatment
FROM commission_plans p
WHERE p.plan_family='referral' AND p.outright_applies=1 AND p.max_duration_months=0
  AND NOT EXISTS (SELECT 1 FROM commission_plan_versions v WHERE v.plan_id=p.id);

-- Snapshot the current rules into every empty referral version so historical
-- payments can be recalculated with the rule version that was active then.
UPDATE commission_plan_versions
SET rules_json = (
  SELECT json_group_array(json_object(
    'role_name', r.role_name,
    'rate_bps', r.rate_bps,
    'fixed_amount_kobo', r.fixed_amount_kobo,
    'sales_type', r.sales_type,
    'is_active', r.is_active,
    'rule_type', r.rule_type,
    'stage_amount_kobo', r.stage_amount_kobo,
    'stage1_cap_kobo', r.stage1_cap_kobo,
    'stage2_cap_kobo', r.stage2_cap_kobo,
    'max_cap_kobo', r.max_cap_kobo,
    'applies_to', r.applies_to
  ))
  FROM commission_plan_rules r
  WHERE r.plan_id = commission_plan_versions.plan_id AND r.is_active=1
)
WHERE plan_id IN (SELECT id FROM commission_plans WHERE plan_family='referral')
  AND (rules_json IS NULL OR rules_json='' OR rules_json='[]');
