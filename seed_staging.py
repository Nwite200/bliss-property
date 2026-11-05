#!/usr/bin/env python3
"""Seed the staging D1 database with realistic, clearly-labelled test data.

Only the known staging database ID is accepted. All writes go through Wrangler
`d1 execute --remote` to that ID. Plaintext passwords are never written to disk:
the SQL file contains PBKDF2 hashes only, and the generated credentials are
printed to the terminal once.

Usage:
  SEED_ENV=staging ENVIRONMENT=staging STAGING_DB_ID=<uuid> \\
    python3 seed_staging.py --apply

Without --apply it prints the statement count and exits (dry run).
"""

import argparse
import base64
import hashlib
import json
import os
import re
import secrets
import subprocess
import sys
import tempfile
from datetime import date, timedelta

from seed_guard import STAGING_DB_ID, require_staging

DATABASE = "bliss-legacy-staging-db"
PASSWORD = {}


def hash_pw(value: str) -> str:
    salt = os.urandom(16)
    dk = hashlib.pbkdf2_hmac("sha256", value.encode("utf-8"), salt, 100000)
    return (
        f"pbkdf2$100000${base64.b64encode(salt).decode('utf-8')}"
        f"${base64.b64encode(dk).decode('utf-8')}"
    )


def q(value) -> str:
    if value is None:
        return "NULL"
    if isinstance(value, (int, float)):
        return str(value)
    return "'" + str(value).replace("'", "''") + "'"


def run(statements, label="seed"):
    sql = ";\n".join(statements) + ";\n"
    handle = tempfile.NamedTemporaryFile("w", suffix=".sql", delete=False)
    try:
        handle.write(sql)
        handle.close()
        result = subprocess.run(
            ["npx", "wrangler", "d1", "execute", DATABASE, "--remote", "--file", handle.name],
            capture_output=True, text=True,
        )
        if result.returncode != 0:
            print(result.stdout[-1500:])
            print(result.stderr[-1500:], file=sys.stderr)
            raise SystemExit(f"{label}: wrangler failed with exit {result.returncode}")
        return result.stdout
    finally:
        os.unlink(handle.name)


def query(command):
    result = subprocess.run(
        ["npx", "wrangler", "d1", "execute", DATABASE, "--remote", "--json", "--command", command],
        capture_output=True, text=True,
    )
    if result.returncode != 0:
        raise SystemExit(result.stderr[-1000:] or result.stdout[-1000:])
    match = re.search(r"\[\s*\{.*\}\s*\]", result.stdout, re.S)
    payload = json.loads(match.group(0)) if match else []
    return payload


def todays():
    return os.environ.get("SEED_TODAY") or date.today().isoformat()


def day(offset):
    return (date.fromisoformat(todays()) + timedelta(days=offset)).isoformat()


def month_end():
    today = date.fromisoformat(todays())
    nxt = (today.replace(day=28) + timedelta(days=4)).replace(day=1)
    return (nxt - timedelta(days=1)).isoformat()


def build_statements():
    statements = []
    today = todays()
    valid_until = month_end()

    # ---- staff -----------------------------------------------------------
    users = [
        ("staging.bm.ajah@blisslegacy.test", "Staging Ajah Branch Manager", 2, 2, 0, "NULL"),
        ("staging.marketer.ajah@blisslegacy.test", "Staging Ajah Marketer (no Team Lead)", 4, 2, 0,
         "(SELECT id FROM users WHERE email='staging.bm.ajah@blisslegacy.test')"),
        ("staging.commission@blisslegacy.test", "Staging Commission Access Only", 5, 6, 1, "NULL"),
    ]
    for email, name, role_id, branch_id, commission_access, manager_sql in users:
        PASSWORD[email] = secrets.token_urlsafe(18)
        statements.append(
            f"""INSERT INTO users (email, password_hash, full_name, role_id, branch_id, is_active,
                 is_test, test_expires_at, access_valid_until, manager_id, commission_access, care_scope)
               VALUES ({q(email)}, {q(hash_pw(PASSWORD[email]))}, {q(name)}, {role_id}, {branch_id}, 1,
                 1, datetime('now','+14 days'), {q(valid_until)}, {manager_sql}, {commission_access}, NULL)
               ON CONFLICT(email) DO UPDATE SET password_hash=excluded.password_hash,
                 full_name=excluded.full_name, role_id=excluded.role_id, branch_id=excluded.branch_id,
                 is_active=1, is_test=1, test_expires_at=excluded.test_expires_at,
                 access_valid_until=excluded.access_valid_until, manager_id=excluded.manager_id,
                 commission_access=excluded.commission_access"""
        )

    statements.append(
        """INSERT INTO teams (name, branch_id, team_lead_user_id, is_active)
           SELECT 'Staging Ikeja Team', 1, (SELECT id FROM users WHERE email='staging.tl@blisslegacy.test'), 1
           WHERE NOT EXISTS (SELECT 1 FROM teams WHERE name='Staging Ikeja Team' AND branch_id=1)"""
    )
    statements.append(
        """INSERT OR IGNORE INTO team_members (team_id, user_id)
           SELECT t.id, u.id FROM teams t, users u
           WHERE t.name='Staging Ikeja Team' AND t.branch_id=1
             AND u.email IN ('staging.tl@blisslegacy.test','staging.marketer@blisslegacy.test')"""
    )

    # ---- property plans --------------------------------------------------
    plan_specs = {
        "outright": (100, 0, 1, 0),
        "part_payment": (30, 70, 6, 6),
        "daily": (10, 90, 180, 6),
        "weekly": (10, 90, 52, 12),
        "monthly": (10, 90, 12, 12),
    }
    for property_id, price in [(1, 20_000_000_00), (2, 12_000_000_00)]:
        for plan_type, (deposit_pct, installment_pct, count, months) in plan_specs.items():
            deposit = int(price * deposit_pct / 100)
            installment = int(price * installment_pct / 100 / count)
            statements.append(
                f"""INSERT INTO property_payment_plans (property_id, plan_type, total_price_kobo,
                     deposit_kobo, installment_kobo, duration_months, number_of_installments,
                     is_enabled, notes, created_by)
                   VALUES ({property_id}, {q(plan_type)}, {price}, {deposit}, {installment},
                     {months if months else 'NULL'}, {count}, 1,
                     'STAGING TEST plan — fictional data', (SELECT id FROM users WHERE email='staging.md@blisslegacy.test'))
                   ON CONFLICT(property_id, plan_type) DO UPDATE SET total_price_kobo=excluded.total_price_kobo,
                     deposit_kobo=excluded.deposit_kobo, installment_kobo=excluded.installment_kobo,
                     duration_months=excluded.duration_months,
                     number_of_installments=excluded.number_of_installments, is_enabled=1"""
            )

    # ---- clean previous run of this seed only ---------------------------
    statements.extend([
        "DELETE FROM sms_messages WHERE client_id IN (SELECT id FROM clients WHERE client_reference LIKE 'TEST-STG-%')",
        "DELETE FROM client_care_calls WHERE client_id IN (SELECT id FROM clients WHERE client_reference LIKE 'TEST-STG-%')",
        "DELETE FROM client_care_records WHERE client_id IN (SELECT id FROM clients WHERE client_reference LIKE 'TEST-STG-%')",
        "DELETE FROM payment_schedule_items WHERE schedule_id IN (SELECT id FROM payment_schedules WHERE client_id IN (SELECT id FROM clients WHERE client_reference LIKE 'TEST-STG-%'))",
        "DELETE FROM payments WHERE client_id IN (SELECT id FROM clients WHERE client_reference LIKE 'TEST-STG-%')",
        "DELETE FROM payment_schedules WHERE client_id IN (SELECT id FROM clients WHERE client_reference LIKE 'TEST-STG-%')",
        "DELETE FROM client_assignments WHERE client_id IN (SELECT id FROM clients WHERE client_reference LIKE 'TEST-STG-%')",
        "DELETE FROM client_properties WHERE client_id IN (SELECT id FROM clients WHERE client_reference LIKE 'TEST-STG-%')",
        "DELETE FROM lead_follow_ups WHERE lead_id IN (SELECT id FROM leads WHERE lead_reference LIKE 'TEST-STG-%')",
        "DELETE FROM lead_temperature_history WHERE lead_id IN (SELECT id FROM leads WHERE lead_reference LIKE 'TEST-STG-%')",
        "DELETE FROM leads WHERE lead_reference LIKE 'TEST-STG-%'",
        "DELETE FROM clients WHERE client_reference LIKE 'TEST-STG-%'",
    ])

    # ---- clients, schedules, payments -----------------------------------
    # reference, name, plan, branch, marketer email, team lead email, status,
    # phone, performing/defaulting
    clients = [
        ("TEST-STG-C01", "STAGING TEST Outright Buyer", "outright", 1, "staging.marketer@blisslegacy.test",
         "staging.tl@blisslegacy.test", "+2348039001001", "performing", 1),
        ("TEST-STG-C02", "STAGING TEST Part Payment Buyer", "part_payment", 1, "staging.marketer@blisslegacy.test",
         "staging.tl@blisslegacy.test", "+2348039001002", "performing", 1),
        ("TEST-STG-C03", "STAGING TEST Daily Saver", "daily", 2, "staging.marketer.ajah@blisslegacy.test",
         None, "+2348039001003", "defaulting", 2),
        ("TEST-STG-C04", "STAGING TEST Weekly Saver", "weekly", 2, "staging.marketer.ajah@blisslegacy.test",
         None, "+2348039001004", "performing", 2),
        ("TEST-STG-C05", "STAGING TEST Monthly Saver", "monthly", 1, "staging.marketer@blisslegacy.test",
         "staging.tl@blisslegacy.test", "+2348039001005", "defaulting", 1),
        ("TEST-STG-C06", "STAGING TEST Pending Clearance", "monthly", 1, "staging.marketer@blisslegacy.test",
         "staging.tl@blisslegacy.test", "+2348039001006", "performing", 1),
        ("TEST-STG-C07", "STAGING TEST Cleared Client", "outright", 2, "staging.marketer.ajah@blisslegacy.test",
         None, "+2348039001007", "performing", 2),
        ("TEST-STG-C08", "STAGING TEST Bad Phone Pending", "weekly", 1, "staging.marketer@blisslegacy.test",
         "staging.tl@blisslegacy.test", "08039001008", "defaulting", 1),
        ("TEST-STG-C09", "STAGING TEST Missing Phone Cleared", "daily", 2, "staging.marketer.ajah@blisslegacy.test",
         None, "", "performing", 2),
    ]
    plan_prices = {1: 20_000_000_00, 2: 12_000_000_00}
    for ref, name, plan_type, branch_id, marketer_email, tl_email, phone, performance, property_id in clients:
        price = plan_prices[property_id]
        deposit = int(price * 0.10) if plan_type != "outright" else 0
        count = {"outright": 1, "part_payment": 6, "daily": 180, "weekly": 52, "monthly": 12}[plan_type]
        installment = int((price - deposit) / count)
        tl_sql = f"(SELECT id FROM users WHERE email={q(tl_email)})" if tl_email else "NULL"
        statements.append(
            f"""INSERT INTO clients (client_reference, full_name, phone_number, email_address, status, sale_type,
                 assigned_branch_id, created_by, original_marketer_id, team_lead_id, agreed_purchase_price,
                 interested_property_id, payment_plan_type, payment_plan_total_kobo, payment_plan_deposit_kobo,
                 payment_plan_installment_kobo, payment_plan_number_of_installments, payment_plan_locked_at,
                 property_payment_plan_id)
               VALUES ({q(ref)}, {q(name)}, {q(phone)}, {q(ref.lower() + '@blisslegacy.test')}, 'Active Buyer',
                 'New Sale', {branch_id}, (SELECT id FROM users WHERE email={q(marketer_email)}),
                 (SELECT id FROM users WHERE email={q(marketer_email)}), {tl_sql}, {price},
                 {property_id}, {q(plan_type)}, {price}, {deposit}, {installment}, {count},
                 datetime('now'), (SELECT id FROM property_payment_plans WHERE property_id={property_id} AND plan_type={q(plan_type)}))"""
        )
        statements.append(
            f"""INSERT INTO client_assignments (client_id, relationship_manager_id, branch_id, team_lead_id, assigned_by, is_primary)
               SELECT c.id, (SELECT id FROM users WHERE email={q(marketer_email)}), {branch_id}, {tl_sql},
                 (SELECT id FROM users WHERE email='staging.bm.ajah@blisslegacy.test'), 1
               FROM clients c WHERE c.client_reference={q(ref)}
                 AND NOT EXISTS (SELECT 1 FROM client_assignments ca WHERE ca.client_id=c.id AND ca.is_primary=1)"""
        )
        statements.append(
            f"""INSERT INTO client_properties (client_id, property_id, agreed_purchase_price, status, plan_type)
               SELECT c.id, {property_id}, {price}, 'Active', {q(plan_type)}
               FROM clients c WHERE c.client_reference={q(ref)}
                 AND NOT EXISTS (SELECT 1 FROM client_properties cp WHERE cp.client_id=c.id AND cp.property_id={property_id})"""
        )

        due1 = day(-45 if performance == "performing" else -75)
        due2 = day(20 if performance == "performing" else -15)
        next_due = due2
        frequency = {"outright": 0, "part_payment": 30, "daily": 1, "weekly": 7, "monthly": 30}[plan_type]
        status = "active"
        statements.append(
            f"""INSERT INTO payment_schedules (client_id, property_id, total_amount, deposit_amount, installment_amount,
                 frequency_days, next_due_date, created_by, status, total_kobo, deposit_kobo, installment_kobo,
                 plan_type, start_date, grace_days, number_of_installments, property_payment_plan_id, locked_plan_json)
               SELECT c.id, {property_id}, {price/100}, {deposit/100}, {installment/100}, {frequency}, {q(next_due)},
                 (SELECT id FROM users WHERE email={q(marketer_email)}), {q(status)}, {price}, {deposit}, {installment},
                 {q(plan_type)}, {q(day(-90))}, 5, {count},
                 (SELECT id FROM property_payment_plans WHERE property_id={property_id} AND plan_type={q(plan_type)}),
                 '{{"seed":"staging","plan_type":"{plan_type}"}}'
               FROM clients c WHERE c.client_reference={q(ref)}"""
        )
        paid1 = installment
        paid2 = installment if performance == "performing" else 0
        statements.append(
            f"""INSERT INTO payment_schedule_items (schedule_id, sequence_no, due_date, amount_kobo, paid_kobo, status)
               SELECT s.id, 1, {q(due1)}, {installment}, {paid1}, 'paid'
               FROM payment_schedules s JOIN clients c ON c.id=s.client_id WHERE c.client_reference={q(ref)}"""
        )
        statements.append(
            f"""INSERT INTO payment_schedule_items (schedule_id, sequence_no, due_date, amount_kobo, paid_kobo, status)
               SELECT s.id, 2, {q(due2)}, {installment}, {paid2}, {q('paid' if performance == 'performing' else 'expected')}
               FROM payment_schedules s JOIN clients c ON c.id=s.client_id WHERE c.client_reference={q(ref)}"""
        )
        if performance == "performing":
            statements.append(
                f"""INSERT INTO payments (client_id, property_id, transaction_ref, amount, currency, method, status,
                     amount_kobo, is_demo, provider, payment_mode, verified_at, commission_state)
                   SELECT c.id, {property_id}, {q('TEST-STG-PAY-' + ref[-3:])}, {paid2/100}, 'NGN', 'Bank Transfer',
                     'verified', {paid2}, 0, 'mock', 'test', datetime('now','-20 days'), 'pending'
                   FROM clients c WHERE c.client_reference={q(ref)}
                     AND NOT EXISTS (SELECT 1 FROM payments p WHERE p.transaction_ref={q('TEST-STG-PAY-' + ref[-3:])})"""
            )

    # ---- care records and calls -----------------------------------------
    care = [
        ("TEST-STG-C06", "pending_clearance", None),
        ("TEST-STG-C07", "cleared", "Identity and next of kin confirmed"),
        ("TEST-STG-C08", "pending_clearance", None),
        ("TEST-STG-C09", "cleared", "Phone captured during office visit"),
    ]
    for ref, status, note in care:
        cleared_sql = "datetime('now','-5 days')" if status == "cleared" else "NULL"
        cleared_by = "(SELECT id FROM users WHERE email='care.national.staging@blisslegacy.test')" if status == "cleared" else "NULL"
        statements.append(
            f"""INSERT INTO client_care_records (client_id, care_status, assigned_user_id, clearance_note,
                 cleared_by, cleared_at, last_call_at, next_follow_up_date, updated_by)
               SELECT c.id, {q(status)}, (SELECT id FROM users WHERE email='care.national.staging@blisslegacy.test'),
                 {q(note)}, {cleared_by}, {cleared_sql}, datetime('now','-2 days'), {q(day(3))},
                 (SELECT id FROM users WHERE email='care.national.staging@blisslegacy.test')
               FROM clients c WHERE c.client_reference={q(ref)}
               ON CONFLICT(client_id) DO UPDATE SET care_status=excluded.care_status,
                 clearance_note=excluded.clearance_note, cleared_by=excluded.cleared_by,
                 cleared_at=excluded.cleared_at, updated_by=excluded.updated_by"""
        )
        statements.append(
            f"""INSERT INTO client_care_calls (client_id, care_user_id, call_type, note, outcome, next_follow_up_date)
               SELECT c.id, (SELECT id FROM users WHERE email='care.national.staging@blisslegacy.test'),
                 'call', 'STAGING TEST care call', 'Contacted', {q(day(3))}
               FROM clients c WHERE c.client_reference={q(ref)}"""
        )

    # ---- SMS log in every status ----------------------------------------
    sms_statuses = ["queued", "sent", "delivered", "failed", "opted_out", "skipped"]
    for index, status in enumerate(sms_statuses, start=1):
        ref = f"TEST-STG-C{index:02d}"
        delivered = "datetime('now','-1 day')" if status in ("sent", "delivered") else "NULL"
        failed = "datetime('now','-1 day')" if status == "failed" else "NULL"
        statements.append(
            f"""INSERT INTO sms_messages (client_id, template_key, phone_e164, body, status, provider,
                 provider_message_id, attempts, idempotency_key, sent_at, delivered_at, failed_at, created_by)
               SELECT c.id, 'seed_status', c.phone_number, {q('STAGING TEST SMS — ' + status)}, {q(status)}, 'mock',
                 {q('mock-' + status + '-001')}, 1, {q('TEST-STG-SMS-' + status)}, {delivered}, {delivered},
                 {failed}, (SELECT id FROM users WHERE email='staging.md@blisslegacy.test')
               FROM clients c WHERE c.client_reference={q(ref)}
               ON CONFLICT(idempotency_key) DO NOTHING"""
        )

    # ---- leads in every stage + contact history -------------------------
    lead_statuses = ["New Lead", "Contacted", "Interested", "Inspection Scheduled",
                     "Negotiation", "Converted", "Lost"]
    temperatures = ["Hot", "Warm", "Cold"]
    for index, status in enumerate(lead_statuses, start=1):
        ref = f"TEST-STG-LEAD-{index:02d}"
        temperature = temperatures[(index - 1) % 3]
        branch_id = 1 if index % 2 else 2
        marketer = "staging.marketer@blisslegacy.test" if branch_id == 1 else "staging.marketer.ajah@blisslegacy.test"
        tl_sql = "(SELECT id FROM users WHERE email='staging.tl@blisslegacy.test')" if branch_id == 1 else "NULL"
        lost_reason = "Budget deferred" if status == "Lost" else None
        statements.append(
            f"""INSERT INTO leads (lead_reference, full_name, phone_number, email_address, source, status,
                 lead_temperature, temperature_updated_at, lost_reason, property_id, assigned_marketer_id,
                 team_lead_id, branch_id, estimated_value_kobo, notes, next_follow_up_date, created_by, is_demo)
               VALUES ({q(ref)}, {q('STAGING TEST ' + status + ' Lead')},
                 {q('+2348039100' + f'{index:03d}')}, {q(ref.lower() + '@blisslegacy.test')}, 'STAGING TEST seed',
                 {q(status)}, {q(temperature)}, datetime('now','-2 days'), {q(lost_reason)}, {1 if index % 2 else 2},
                 (SELECT id FROM users WHERE email={q(marketer)}), {tl_sql}, {branch_id},
                 {(5_000_000 + index * 500_000) * 100}, 'STAGING TEST lead for audit coverage',
                 {q(day(index))}, (SELECT id FROM users WHERE email='staging.bm.ajah@blisslegacy.test'), 0)"""
        )
        for step in range(1, 3):
            statements.append(
                f"""INSERT INTO lead_follow_ups (lead_id, staff_id, note, channel, outcome, follow_up_date, created_at)
                   SELECT l.id, (SELECT id FROM users WHERE email={q(marketer)}),
                     {q(f'STAGING TEST contact {step}')}, {q('call' if step == 1 else 'whatsapp')},
                     {q('Connected' if step == 1 else 'Interested')}, {q(day(index))}, datetime('now','-{step} day')
                   FROM leads l WHERE l.lead_reference={q(ref)}"""
            )
        if index <= 3:
            statements.append(
                f"""INSERT INTO lead_temperature_history (lead_id, old_temperature, new_temperature, changed_by, reason)
                   SELECT l.id, 'Warm', {q(temperature)},
                     (SELECT id FROM users WHERE email={q(marketer)}), 'STAGING TEST temperature update'
                   FROM leads l WHERE l.lead_reference={q(ref)}"""
            )

    return statements


def main():
    parser = argparse.ArgumentParser(description="Seed staging with safe test data")
    parser.add_argument("--apply", action="store_true", help="write to staging (default is dry run)")
    args = parser.parse_args()

    require_staging("seed_staging.py", os.environ.get("STAGING_DB_ID", STAGING_DB_ID), "remote")
    statements = build_statements()
    print(f"Prepared {len(statements)} SQL statements for staging.")
    if not args.apply:
        print("Dry run only. Re-run with --apply to write.")
        return 0

    run(statements, "staging seed")
    counts = query(
        "SELECT "
        "(SELECT COUNT(*) FROM branches) branches,"
        "(SELECT COUNT(*) FROM users WHERE is_test=1) test_users,"
        "(SELECT COUNT(*) FROM clients WHERE client_reference LIKE 'TEST-STG-%') clients,"
        "(SELECT COUNT(*) FROM property_payment_plans WHERE notes LIKE 'STAGING TEST%') plans,"
        "(SELECT COUNT(*) FROM payment_schedules WHERE client_id IN (SELECT id FROM clients WHERE client_reference LIKE 'TEST-STG-%')) schedules,"
        "(SELECT COUNT(*) FROM sms_messages WHERE idempotency_key LIKE 'TEST-STG-SMS-%') sms,"
        "(SELECT COUNT(*) FROM leads WHERE lead_reference LIKE 'TEST-STG-%') leads,"
        "(SELECT COUNT(*) FROM lead_follow_ups WHERE lead_id IN (SELECT id FROM leads WHERE lead_reference LIKE 'TEST-STG-%')) follow_ups,"
        "(SELECT COUNT(*) FROM client_care_records WHERE client_id IN (SELECT id FROM clients WHERE client_reference LIKE 'TEST-STG-%')) care_records"
    )
    print("Staging seed complete.")
    print(json.dumps(counts[0]["results"][0], indent=2))
    print("Generated test credentials (shown once, not stored):")
    for email, password in PASSWORD.items():
        print(f"  {email} / {password}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
