"""Deterministic local demo seed for the Bliss Legacy Phase 5 portal.

Run after applying local D1 migrations:

    python3 seed_phase5.py

The script is safe to re-run: users are upserted by email, demo clients are
upserted by client reference, and transactional demo records for those clients
are replaced with a known baseline. It never touches other clients' records and
never deletes audit history.
"""

import base64
import hashlib
import os
import secrets
import sys
import sqlite3

from seed_guard import require_local
from datetime import datetime, timedelta

DB_PATH = (
    ".wrangler/state/v3/d1/miniflare-D1DatabaseObject/"
    "c6c9fe2e839a026d2bc28c3710008b8d91b43bb2bed7c7b18fa3ea4062dfb1a0.sqlite"
)

DEMO_CLIENT_REF = "DEMO-CLIENT-001"

TEST_PASSWORDS = {}


def seed_guard():
    require_local("seed_phase5.py", DB_PATH)


def hash_pw(pw: str) -> str:
    salt = os.urandom(16)
    dk = hashlib.pbkdf2_hmac("sha256", pw.encode("utf-8"), salt, 100000)
    return (
        f"pbkdf2$100000${base64.b64encode(salt).decode('utf-8')}"
        f"${base64.b64encode(dk).decode('utf-8')}"
    )


def ensure_user(cur, email, full_name, role_id, branch_id=1):
    cur.execute("SELECT id FROM users WHERE email=?", (email,))
    row = cur.fetchone()
    if row:
        # Generate a fresh random password per run; only the hash is stored.
        cur.execute(
            "UPDATE users SET password_hash=?, full_name=?, role_id=?, branch_id=?, is_active=1, is_test=1, test_expires_at=datetime('now','+14 days'), access_valid_until=CASE WHEN ?=4 THEN date('now','start of month','+1 month','-1 day') ELSE access_valid_until END WHERE id=?",
            (hash_pw(TEST_PASSWORDS.setdefault(email, secrets.token_urlsafe(18))), full_name, role_id, branch_id, role_id, row[0]),
        )
        return row[0]
    cur.execute(
        """
        INSERT INTO users (email, password_hash, full_name, role_id, branch_id, is_active, is_test, test_expires_at, access_valid_until)
        VALUES (?, ?, ?, ?, ?, 1, 1, datetime('now','+14 days'), CASE WHEN ?=4 THEN date('now','start of month','+1 month','-1 day') ELSE NULL END)
        """,
        (email, hash_pw(TEST_PASSWORDS.setdefault(email, secrets.token_urlsafe(18))), full_name, role_id, branch_id, role_id),
    )
    return cur.lastrowid


def ensure_client(cur, reference, defaults, user_id=None):
    cur.execute("SELECT id FROM clients WHERE client_reference=?", (reference,))
    row = cur.fetchone()
    if row:
        client_id = row[0]
        cur.execute(
            """
            UPDATE clients
               SET full_name=?, phone_number=?, email_address=?, residential_address=?,
                   state=?, city=?, next_of_kin=?, status=?, assigned_branch_id=?,
                   created_by=?, original_marketer_id=?, team_lead_id=?,
                   agreed_purchase_price=?, interested_property_id=?, user_id=?,
                   is_deleted=0, updated_at=datetime('now')
             WHERE id=?
            """,
            (
                defaults["full_name"],
                defaults["phone_number"],
                defaults.get("email_address"),
                defaults.get("residential_address"),
                defaults.get("state"),
                defaults.get("city"),
                defaults.get("next_of_kin"),
                defaults.get("status", "Active Buyer"),
                defaults.get("assigned_branch_id", 1),
                defaults.get("created_by", 3),
                defaults.get("original_marketer_id", 3),
                defaults.get("team_lead_id"),
                defaults.get("agreed_purchase_price", 0),
                defaults.get("interested_property_id"),
                user_id,
                client_id,
            ),
        )
        return client_id

    cur.execute(
        """
        INSERT INTO clients (
            client_reference, full_name, phone_number, email_address,
            residential_address, state, city, next_of_kin, status,
            assigned_branch_id, created_by, original_marketer_id, team_lead_id,
            agreed_purchase_price, interested_property_id, user_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            reference,
            defaults["full_name"],
            defaults["phone_number"],
            defaults.get("email_address"),
            defaults.get("residential_address"),
            defaults.get("state"),
            defaults.get("city"),
            defaults.get("next_of_kin"),
            defaults.get("status", "Active Buyer"),
            defaults.get("assigned_branch_id", 1),
            defaults.get("created_by", 3),
            defaults.get("original_marketer_id", 3),
            defaults.get("team_lead_id"),
            defaults.get("agreed_purchase_price", 0),
            defaults.get("interested_property_id"),
            user_id,
        ),
    )
    return cur.lastrowid


def clear_client_financials(cur, client_ids):
    """Remove demo financial rows in FK-safe order. Audit logs are preserved."""
    placeholders = ",".join("?" for _ in client_ids)
    cur.execute(
        f"DELETE FROM financial_adjustments WHERE payment_id IN "
        f"(SELECT id FROM payments WHERE client_id IN ({placeholders}))",
        tuple(client_ids),
    )
    cur.execute(
        f"DELETE FROM receipts WHERE client_id IN ({placeholders})", tuple(client_ids)
    )
    cur.execute(
        f"DELETE FROM payments WHERE client_id IN ({placeholders})", tuple(client_ids)
    )
    cur.execute(
        f"DELETE FROM payment_schedule_history WHERE schedule_id IN "
        f"(SELECT id FROM payment_schedules WHERE client_id IN ({placeholders}))",
        tuple(client_ids),
    )
    cur.execute(
        f"DELETE FROM payment_schedules WHERE client_id IN ({placeholders})",
        tuple(client_ids),
    )
    cur.execute(
        f"DELETE FROM notifications WHERE client_id IN ({placeholders})",
        tuple(client_ids),
    )


def seed():
    seed_guard()
    conn = sqlite3.connect(DB_PATH)
    conn.execute("PRAGMA foreign_keys = ON")
    cur = conn.cursor()

    print("Seeding Phase 5 demo users and data…")

    finance_user_id = ensure_user(
        cur, "finance@bliss.com", "Head Finance Officer", 5, 1
    )
    ada_user_id = ensure_user(cur, "ada@example.com", "Ada Nwosu", 6, 1)
    musa_user_id = ensure_user(cur, "musa@example.com", "Musa Dike", 6, 1)
    demo_user_id = ensure_user(cur, "demo@bliss.com", "Demo Investor", 6, 1)

    ada_client_id = ensure_client(
        cur,
        "BLC-MW2ER37J",
        {
            "full_name": "Ada Nwosu",
            "phone_number": "08011112222",
            "email_address": "ada@example.com",
            "residential_address": "14 Victoria Island, Lagos",
            "state": "Lagos",
            "city": "Ikeja",
            "next_of_kin": "Emeka Nwosu (Brother, 08012345678)",
            "assigned_branch_id": 1,
            "created_by": 3,
            "original_marketer_id": 3,
            "agreed_purchase_price": 12000000,
            "interested_property_id": 2,
        },
        user_id=ada_user_id,
    )

    musa_client_id = ensure_client(
        cur,
        "BLC-MW2F7LG0",
        {
            "full_name": "Musa Dike",
            "phone_number": "08033334444",
            "email_address": "musa@example.com",
            "residential_address": "2 Abuja Road",
            "state": "FCT",
            "city": "Abuja",
            "assigned_branch_id": 1,
            "created_by": 3,
            "original_marketer_id": 3,
            "agreed_purchase_price": 20000000,
            "interested_property_id": 1,
        },
        user_id=musa_user_id,
    )

    demo_client_id = ensure_client(
        cur,
        DEMO_CLIENT_REF,
        {
            "full_name": "Demo Investor",
            "phone_number": "08099998888",
            "email_address": "demo@bliss.com",
            "residential_address": "Demo Street, Abuja",
            "state": "FCT",
            "city": "Abuja",
            "assigned_branch_id": 1,
            "created_by": 3,
            "original_marketer_id": 3,
            "agreed_purchase_price": 15000000,
            "interested_property_id": 2,
        },
        user_id=demo_user_id,
    )

    client_ids = [ada_client_id, musa_client_id, demo_client_id]
    clear_client_financials(cur, client_ids)

    # --- Ada: one verified payment + receipt, one pending payment -----------
    cur.execute(
        """
        INSERT INTO payments (
            client_id, property_id, transaction_ref, amount, currency, method,
            status, amount_kobo, is_demo, verified_at, verified_by, created_at
        ) VALUES (?, 2, 'TX-VERIFIED-ADA-01', 5000000, 'NGN', 'Bank Transfer',
                  'verified', 500000000, 0, datetime('now', '-2 days'), ?,
                  datetime('now', '-2 days'))
        """,
        (ada_client_id, finance_user_id),
    )
    ada_payment_1 = cur.lastrowid

    cur.execute(
        """
        INSERT INTO receipts (
            payment_id, client_id, receipt_ref, amount, currency,
            amount_kobo, remaining_balance_kobo, is_demo, created_at
        ) VALUES (?, ?, 'RCP-BLISS-001', 5000000, 'NGN',
                  500000000, 700000000, 0, datetime('now', '-2 days'))
        """,
        (ada_payment_1, ada_client_id),
    )

    cur.execute(
        """
        INSERT INTO payments (
            client_id, property_id, transaction_ref, amount, currency, method,
            status, amount_kobo, is_demo, created_at
        ) VALUES (?, 2, 'TX-PENDING-ADA-02', 2000000, 'NGN', 'Bank Transfer',
                  'pending', 200000000, 0, datetime('now', '-3 hours'))
        """,
        (ada_client_id,),
    )

    # Ada installment plan: 12M total, 3M deposit, 1.5M monthly, due in 15 days.
    next_due = (datetime.now() + timedelta(days=15)).strftime("%Y-%m-%d")
    cur.execute(
        """
        INSERT INTO payment_schedules (
            client_id, property_id, total_amount, total_kobo,
            deposit_amount, deposit_kobo, installment_amount, installment_kobo,
            frequency_days, next_due_date, status, notes, created_by,
            created_at, updated_at
        ) VALUES (?, 2, 12000000, 1200000000, 3000000, 300000000,
                  1500000, 150000000, 30, ?, 'active',
                  'Seeded demo plan (no penalty logic applied)', ?,
                  datetime('now'), datetime('now'))
        """,
        (ada_client_id, next_due, finance_user_id),
    )
    ada_schedule_id = cur.lastrowid
    cur.execute(
        """
        INSERT INTO payment_schedule_history (
            schedule_id, action, previous_json, new_json, reason, changed_by
        ) VALUES (?, 'create', NULL, ?, 'Seeded demo plan', ?)
        """,
        (
            ada_schedule_id,
            '{"frequency_days":30,"installment_kobo":150000000}',
            finance_user_id,
        ),
    )

    cur.execute(
        """
        INSERT INTO notifications (client_id, type, title, message, is_read, created_at)
        VALUES (?, 'payment.verified', 'Official Receipt Issued',
                'Your payment of NGN 5,000,000 has been verified. Official Receipt #RCP-BLISS-001 is now ready.',
                0, datetime('now', '-2 days'))
        """,
        (ada_client_id,),
    )
    cur.execute(
        """
        INSERT INTO notifications (client_id, type, title, message, is_read, created_at)
        VALUES (?, 'payment.pending', 'Payment Awaiting Verification',
                'We received your payment notice for NGN 2,000,000 (Ref: TX-PENDING-ADA-02). Our finance team is reconciling.',
                0, datetime('now', '-3 hours'))
        """,
        (ada_client_id,),
    )

    # --- Demo client: isolated demo payment + stamped DEMO receipt ----------
    cur.execute(
        """
        INSERT INTO payments (
            client_id, property_id, transaction_ref, amount, currency, method,
            status, amount_kobo, is_demo, verified_at, verified_by, created_at
        ) VALUES (?, 2, 'TX-DEMO-SIM-01', 3000000, 'NGN', 'Bank Transfer',
                  'verified', 300000000, 1, datetime('now', '-1 days'), ?,
                  datetime('now', '-1 days'))
        """,
        (demo_client_id, finance_user_id),
    )
    demo_payment_id = cur.lastrowid

    cur.execute(
        """
        INSERT INTO receipts (
            payment_id, client_id, receipt_ref, amount, currency,
            amount_kobo, remaining_balance_kobo, is_demo, created_at
        ) VALUES (?, ?, 'DEMO-RCP-001', 3000000, 'NGN',
                  300000000, 1200000000, 1, datetime('now', '-1 days'))
        """,
        (demo_payment_id, demo_client_id),
    )

    # --- Provider configuration stays honest: no credentials, no accounts ---
    cur.execute(
        "SELECT provider_key FROM provider_configs WHERE provider_key='wema_alat'"
    )
    if cur.fetchone():
        cur.execute(
            """
            UPDATE provider_configs
               SET status='Awaiting onboarding', environment='sandbox',
                   webhook_secret=NULL,
                   config_json='{"merchant_id":"","webhook_url":"/api/webhooks/wema-alat","reconciliation_enabled":false}',
                   updated_at=datetime('now')
             WHERE provider_key='wema_alat'
            """
        )
    else:
        cur.execute(
            """
            INSERT INTO provider_configs (
                provider_key, provider_name, status, environment, config_json, created_at
            ) VALUES ('wema_alat', 'ALAT by Wema Bank', 'Awaiting onboarding',
                      'sandbox',
                      '{"merchant_id":"","webhook_url":"/api/webhooks/wema-alat","reconciliation_enabled":false}',
                      datetime('now'))
            """
        )

    conn.commit()
    conn.close()
    print("Seed complete.")
    print(f"  Ada client id={ada_client_id} (BLC-MW2ER37J) — verified NGN 5,000,000, pending NGN 2,000,000")
    print(f"  Musa client id={musa_client_id} (BLC-MW2F7LG0) — no payments, full NGN 20,000,000 outstanding")
    print(f"  Demo client id={demo_client_id} ({DEMO_CLIENT_REF}) — demo-only NGN 3,000,000")



if __name__ == "__main__":
    seed()
