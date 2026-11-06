-- Manual rollback for 0027_configurable_referral_rules.sql. Do not apply automatically.
PRAGMA foreign_keys = ON;

DELETE FROM commission_plan_versions WHERE plan_id IN (
  SELECT id FROM commission_plans WHERE plan_family='referral' AND outright_applies=1 AND max_duration_months=0
);
DELETE FROM commission_plan_rules WHERE plan_id IN (
  SELECT id FROM commission_plans WHERE plan_family='referral' AND outright_applies=1 AND max_duration_months=0
);
DELETE FROM commission_plans WHERE plan_family='referral' AND outright_applies=1 AND max_duration_months=0;

UPDATE commission_plans
SET name = 'Referral Short-Term and Outright (Marketer)',
    description = 'Marketer referral commission for plans of 7 months or less and outright purchases: 10% of each verified payment.',
    min_duration_months = 0,
    max_duration_months = 7,
    outright_applies = 1
WHERE plan_family='referral' AND max_duration_months=7 AND outright_applies=0;

ALTER TABLE commission_plan_versions DROP COLUMN outright_treatment;
ALTER TABLE commission_plans DROP COLUMN outright_treatment;
ALTER TABLE commission_plan_rules DROP COLUMN applies_to;
