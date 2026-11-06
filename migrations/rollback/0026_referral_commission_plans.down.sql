-- Manual rollback for 0026_referral_commission_plans.sql. Do not apply automatically.
PRAGMA foreign_keys = ON;

DELETE FROM commission_plan_versions WHERE plan_id IN (
  SELECT id FROM commission_plans WHERE plan_family='referral'
);
DELETE FROM commission_plan_rules WHERE plan_id IN (
  SELECT id FROM commission_plans WHERE plan_family='referral'
);
DELETE FROM commission_plans WHERE plan_family='referral';

ALTER TABLE referral_commission_accounts DROP COLUMN carry_forward_kobo;
ALTER TABLE referral_commission_accounts DROP COLUMN rule_snapshot_json;
ALTER TABLE referral_commission_accounts DROP COLUMN plan_version_no;

ALTER TABLE commission_plan_versions DROP COLUMN outright_applies;
ALTER TABLE commission_plan_versions DROP COLUMN max_duration_months;
ALTER TABLE commission_plan_versions DROP COLUMN min_duration_months;
ALTER TABLE commission_plan_versions DROP COLUMN sale_type;
ALTER TABLE commission_plan_versions DROP COLUMN plan_family;

ALTER TABLE commission_plan_rules DROP COLUMN max_cap_kobo;
ALTER TABLE commission_plan_rules DROP COLUMN stage2_cap_kobo;
ALTER TABLE commission_plan_rules DROP COLUMN stage1_cap_kobo;
ALTER TABLE commission_plan_rules DROP COLUMN stage_amount_kobo;
ALTER TABLE commission_plan_rules DROP COLUMN rule_type;

ALTER TABLE commission_plans DROP COLUMN outright_applies;
ALTER TABLE commission_plans DROP COLUMN max_duration_months;
ALTER TABLE commission_plans DROP COLUMN min_duration_months;
ALTER TABLE commission_plans DROP COLUMN sale_type;
ALTER TABLE commission_plans DROP COLUMN plan_family;
