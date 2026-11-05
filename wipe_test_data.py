#!/usr/bin/env python3
"""Remove seeded TEST accounts and only their seeded data.

Safety rules:
  * refuses unless the environment guard confirms local or staging;
  * requires an explicit confirmation prompt (or --yes for automation);
  * identifies test data from is_test=1 users plus TEST-/SEED- reference
    prefixes, never from broad name matches;
  * never deletes audit history.

Usage:
  SEED_ENV=local python3 wipe_test_data.py --db <path> [--yes] [--dry-run]
"""

import argparse
import sqlite3
import sys

from seed_guard import require_local


def resolve_ids(cur):
    users = [row[0] for row in cur.execute(
        "SELECT id FROM users WHERE is_test=1"
    ).fetchall()]
    if users:
        marks = ",".join("?" for _ in users)
        clients = [row[0] for row in cur.execute(
            f"SELECT id FROM clients WHERE user_id IN ({marks}) "
            "OR created_by IN ({marks}) OR original_marketer_id IN ({marks}) "
            "OR team_lead_id IN ({marks}) "
            "OR client_reference LIKE 'TEST-%' OR client_reference LIKE 'STAGING-TEST-%'".format(marks=marks),
            users * 4,
        ).fetchall()]
    else:
        clients = [row[0] for row in cur.execute(
            "SELECT id FROM clients WHERE client_reference LIKE 'TEST-%' "
            "OR client_reference LIKE 'STAGING-TEST-%'"
        ).fetchall()]
    if clients:
        marks = ",".join("?" for _ in clients)
        user_marks = placeholders(users)
        leads = [row[0] for row in cur.execute(
            f"SELECT id FROM leads WHERE converted_client_id IN ({marks}) "
            f"OR created_by IN ({user_marks}) OR assigned_marketer_id IN ({user_marks}) "
            "OR lead_reference LIKE 'TEST-%' OR lead_reference LIKE 'STAGING-TEST-%'",
            clients + users + users,
        ).fetchall()]
    else:
        leads = [row[0] for row in cur.execute(
            "SELECT id FROM leads WHERE lead_reference LIKE 'TEST-%' "
            "OR lead_reference LIKE 'STAGING-TEST-%'"
        ).fetchall()]
    properties = [row[0] for row in cur.execute(
        "SELECT id FROM properties WHERE title LIKE 'STAGING TEST%' OR title LIKE 'TEST %'"
    ).fetchall()]
    return users, clients, leads, properties


def placeholders(values):
    return ",".join("?" for _ in values)


def wipe(conn, dry_run=False):
    cur = conn.cursor()
    cur.execute("PRAGMA foreign_keys = ON")
    users, clients, leads, properties = resolve_ids(cur)
    counts = {"users": len(users), "clients": len(clients), "leads": len(leads),
              "properties": len(properties)}
    print("Test data selected:", counts)
    if dry_run:
        return counts

    def run(sql, params=()):
        cur.execute(sql, params)
        return cur.rowcount

    client_marks = placeholders(clients) if clients else None
    user_marks = placeholders(users) if users else None
    lead_marks = placeholders(leads) if leads else None

    if clients:
        for table, column in [
            ("notification_deliveries", "notification_id"),
        ]:
            run(
                f"DELETE FROM {table} WHERE {column} IN "
                f"(SELECT id FROM notifications WHERE client_id IN ({client_marks}))",
                clients,
            )
        run(f"DELETE FROM notifications WHERE client_id IN ({client_marks})", clients)

        entry_filter = f"client_id IN ({client_marks})"
        entry_ids = [row[0] for row in cur.execute(
            f"SELECT id FROM commission_entries WHERE {entry_filter}", clients
        ).fetchall()]
        if entry_ids:
            entry_marks = placeholders(entry_ids)
            run(f"DELETE FROM commission_payments WHERE entry_id IN ({entry_marks})", entry_ids)
            run(f"DELETE FROM commission_adjustments WHERE entry_id IN ({entry_marks})", entry_ids)
            run(f"DELETE FROM commission_approvals WHERE entry_id IN ({entry_marks})", entry_ids)
            run(f"DELETE FROM commission_attributions WHERE entry_id IN ({entry_marks})", entry_ids)
        run(f"DELETE FROM commission_generation_failures WHERE client_id IN ({client_marks})", clients)
        run(f"DELETE FROM commission_entries WHERE {entry_filter}", clients)
        if user_marks:
            recipient_entries = [row[0] for row in cur.execute(
                f"SELECT id FROM commission_entries WHERE recipient_user_id IN ({user_marks})", users
            ).fetchall()]
            if recipient_entries:
                marks = placeholders(recipient_entries)
                run(f"DELETE FROM commission_payments WHERE entry_id IN ({marks})", recipient_entries)
                run(f"DELETE FROM commission_adjustments WHERE entry_id IN ({marks})", recipient_entries)
                run(f"DELETE FROM commission_approvals WHERE entry_id IN ({marks})", recipient_entries)
                run(f"DELETE FROM commission_attributions WHERE entry_id IN ({marks})", recipient_entries)
                run(f"DELETE FROM commission_entries WHERE id IN ({marks})", recipient_entries)

        payment_ids = [row[0] for row in cur.execute(
            f"SELECT id FROM payments WHERE client_id IN ({client_marks})", clients
        ).fetchall()]
        if payment_ids:
            payment_marks = placeholders(payment_ids)
            run(f"DELETE FROM financial_adjustments WHERE payment_id IN ({payment_marks})", payment_ids)
            run(f"DELETE FROM payment_schedule_items WHERE payment_id IN ({payment_marks})", payment_ids)
            run(f"DELETE FROM sms_messages WHERE payment_id IN ({payment_marks})", payment_ids)
            run(f"DELETE FROM commission_generation_failures WHERE payment_id IN ({payment_marks})", payment_ids)
            run(f"DELETE FROM receipts WHERE payment_id IN ({payment_marks})", payment_ids)
            run(f"DELETE FROM payments WHERE id IN ({payment_marks})", payment_ids)

        schedule_ids = [row[0] for row in cur.execute(
            f"SELECT id FROM payment_schedules WHERE client_id IN ({client_marks})", clients
        ).fetchall()]
        if schedule_ids:
            schedule_marks = placeholders(schedule_ids)
            run(f"DELETE FROM payment_schedule_history WHERE schedule_id IN ({schedule_marks})", schedule_ids)
            run(f"DELETE FROM payment_schedule_items WHERE schedule_id IN ({schedule_marks})", schedule_ids)
            run(f"DELETE FROM defaulting_follow_ups WHERE schedule_id IN ({schedule_marks})", schedule_ids)
            run(f"DELETE FROM sms_messages WHERE schedule_id IN ({schedule_marks})", schedule_ids)
            run(f"DELETE FROM payment_schedules WHERE id IN ({schedule_marks})", schedule_ids)

        for table in [
            "client_care_calls", "client_care_records", "client_notes",
            "client_status_history", "client_assignment_history", "client_assignments",
            "client_properties", "client_static_wallets", "client_verification_otps",
            "sms_optouts", "virtual_accounts", "notifications",
        ]:
            run(f"DELETE FROM {table} WHERE client_id IN ({client_marks})", clients)

    if leads:
        run(f"DELETE FROM lead_follow_ups WHERE lead_id IN ({lead_marks})", leads)
        run(f"DELETE FROM lead_temperature_history WHERE lead_id IN ({lead_marks})", leads)
        run(f"DELETE FROM leads WHERE id IN ({lead_marks})", leads)

    if clients:
        run(f"DELETE FROM clients WHERE id IN ({client_marks})", clients)

    if users:
        # Detach nullable references so immutable audit history survives.
        for table in [row[0] for row in cur.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
        ).fetchall()]:
            for fk in cur.execute(f"PRAGMA foreign_key_list({table})").fetchall():
                parent, column = fk[2], fk[3]
                if parent != "users" or not column:
                    continue
                info = [row for row in cur.execute(f"PRAGMA table_info({table})").fetchall() if row[1] == column]
                if not info:
                    continue
                not_null = info[0][3]
                if not not_null:
                    run(f"UPDATE {table} SET {column}=NULL WHERE {column} IN ({user_marks})", users)
        run(f"DELETE FROM password_reset_tokens WHERE user_id IN ({user_marks})", users)
        run(f"DELETE FROM sessions WHERE user_id IN ({user_marks})", users)
        run(f"DELETE FROM staff_profiles WHERE user_id IN ({user_marks})", users)
        run(f"DELETE FROM team_members WHERE user_id IN ({user_marks})", users)
        run(f"DELETE FROM teams WHERE team_lead_user_id IN ({user_marks})", users)
        run(f"UPDATE users SET reactivated_by=NULL WHERE reactivated_by IN ({user_marks})", users)
        run(f"DELETE FROM notification_deliveries WHERE notification_id IN "
            f"(SELECT id FROM notifications WHERE user_id IN ({user_marks}))", users)
        run(f"DELETE FROM notifications WHERE user_id IN ({user_marks})", users)
        run(f"UPDATE users SET manager_id=NULL WHERE manager_id IN ({user_marks})", users)
        run(f"DELETE FROM users WHERE id IN ({user_marks})", users)

    conn.commit()
    return counts


def main():
    parser = argparse.ArgumentParser(description="Wipe seeded TEST accounts and data")
    parser.add_argument("--db", required=True, help="local Wrangler D1 SQLite file")
    parser.add_argument("--yes", action="store_true", help="skip confirmation prompt")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    require_local("wipe_test_data.py", args.db)
    if not args.dry_run and not args.yes:
        answer = input("Type WIPE to delete all TEST accounts and their seeded data: ")
        if answer.strip() != "WIPE":
            print("Aborted.")
            return 1
    conn = sqlite3.connect(args.db)
    try:
        wipe(conn, dry_run=args.dry_run)
    finally:
        conn.close()
    print("Dry run complete." if args.dry_run else "Test data wiped.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
