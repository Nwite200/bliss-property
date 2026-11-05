"""Deterministic local Phase 6 seed.

Run after applying all local migrations:

    python3 seed_phase6.py

This script is safe to re-run. It only ensures demo staff accounts, staff
profiles, teams, team memberships and team-lead attribution. It does not touch
financial records, verified payments, receipts, audit history or client
contract prices. It is excluded from public static assets.
"""

import base64
import hashlib
import os
import secrets
import sys
import sqlite3

from seed_guard import require_local

DB_PATH = (
    ".wrangler/state/v3/d1/miniflare-D1DatabaseObject/"
    "c6c9fe2e839a026d2bc28c3710008b8d91b43bb2bed7c7b18fa3ea4062dfb1a0.sqlite"
)

TEST_PASSWORDS = {}


def seed_guard():
    require_local("seed_phase6.py", DB_PATH)


def hash_pw(pw: str) -> str:
    salt = os.urandom(16)
    dk = hashlib.pbkdf2_hmac("sha256", pw.encode("utf-8"), salt, 100000)
    return (
        f"pbkdf2$100000${base64.b64encode(salt).decode('utf-8')}"
        f"${base64.b64encode(dk).decode('utf-8')}"
    )


def ensure_user(cur, email, full_name, role_id, branch_id):
    cur.execute("SELECT id FROM users WHERE email=?", (email,))
    row = cur.fetchone()
    if row:
        cur.execute(
            """UPDATE users SET password_hash=?, full_name=?, role_id=?, branch_id=?,
               is_active=1, deactivated_at=NULL, is_test=1, test_expires_at=datetime('now','+14 days'), access_valid_until=CASE WHEN role_id=4 THEN date('now','start of month','+1 month','-1 day') ELSE access_valid_until END WHERE id=?""",
            (hash_pw(TEST_PASSWORDS.setdefault(email, secrets.token_urlsafe(18))), full_name, role_id, branch_id, row[0]),
        )
        return row[0]
    cur.execute(
        """INSERT INTO users (email, password_hash, full_name, role_id, branch_id, is_active, is_test, test_expires_at, access_valid_until)
           VALUES (?, ?, ?, ?, ?, 1, 1, datetime('now','+14 days'), CASE WHEN ?=4 THEN date('now','start of month','+1 month','-1 day') ELSE NULL END)""",
        (email, hash_pw(TEST_PASSWORDS.setdefault(email, secrets.token_urlsafe(18))), full_name, role_id, branch_id, role_id),
    )
    return cur.lastrowid


def ensure_profile(cur, user_id, phone, title):
    cur.execute(
        """INSERT INTO staff_profiles (user_id, phone_number, job_title, date_joined, updated_by)
           VALUES (?, ?, ?, date('now','-1 year'), ?)
           ON CONFLICT(user_id) DO UPDATE SET
             phone_number=excluded.phone_number,
             job_title=excluded.job_title,
             updated_at=datetime('now')""",
        (user_id, phone, title, user_id),
    )


def ensure_team(cur, name, branch_id, lead_id, member_ids):
    cur.execute("SELECT id FROM teams WHERE name=? AND branch_id=?", (name, branch_id))
    row = cur.fetchone()
    if row:
        team_id = row[0]
        cur.execute(
            "UPDATE teams SET team_lead_user_id=?, is_active=1 WHERE id=?",
            (lead_id, team_id),
        )
    else:
        cur.execute(
            "INSERT INTO teams (name, branch_id, team_lead_user_id, is_active) VALUES (?, ?, ?, 1)",
            (name, branch_id, lead_id),
        )
        team_id = cur.lastrowid
    cur.execute("DELETE FROM team_members WHERE team_id=?", (team_id,))
    for member_id in member_ids:
        cur.execute(
            "INSERT OR IGNORE INTO team_members (team_id, user_id) VALUES (?, ?)",
            (team_id, member_id),
        )
    return team_id


def seed():
    seed_guard()
    conn = sqlite3.connect(DB_PATH)
    conn.execute("PRAGMA foreign_keys = ON")
    cur = conn.cursor()

    staff = [
        ("md@bliss.com", "Managing Director", 1, None, "08060000000", "Managing Director"),
        ("bm.ikeja@bliss.com", "Ikeja Branch Manager", 2, 1, "08060000001", "Branch Manager"),
        ("bm.ajah@bliss.com", "Ajah Branch Manager", 2, 2, "08060000002", "Branch Manager"),
        ("tl.ikeja@bliss.com", "Ikeja Team Lead", 3, 1, "08060000003", "Team Lead"),
        ("tl.ajah@bliss.com", "Ajah Team Lead", 3, 2, "08060000004", "Team Lead"),
        ("mkt.ikeja@bliss.com", "Ikeja Marketer", 4, 1, "08060000005", "Marketer"),
        ("mkt.ikeja2@bliss.com", "Ikeja Marketer Two", 4, 1, "08060000006", "Marketer"),
        ("mkt.ajah@bliss.com", "Ajah Marketer", 4, 2, "08060000007", "Marketer"),
        ("finance@bliss.com", "Head Finance Officer", 5, 1, "08060000008", "Finance Officer"),
    ]
    ids = {}
    for email, name, role_id, branch_id, phone, title in staff:
        ids[email] = ensure_user(cur, email, name, role_id, branch_id)
        ensure_profile(cur, ids[email], phone, title)

    t1 = ensure_team(
        cur, "Ikeja Team Alpha", 1, ids["tl.ikeja@bliss.com"],
        [ids["tl.ikeja@bliss.com"], ids["mkt.ikeja@bliss.com"], ids["mkt.ikeja2@bliss.com"]],
    )
    t2 = ensure_team(
        cur, "Ajah Team", 2, ids["tl.ajah@bliss.com"],
        [ids["tl.ajah@bliss.com"], ids["mkt.ajah@bliss.com"]],
    )

    # Preserve existing attribution but give demo clients a team lead so the
    # Team Lead dashboard has an authorised portfolio to display.
    cur.execute(
        "UPDATE clients SET team_lead_id=? WHERE assigned_branch_id=1 AND is_deleted=0 AND team_lead_id IS NULL",
        (ids["tl.ikeja@bliss.com"],),
    )
    cur.execute(
        "UPDATE clients SET team_lead_id=? WHERE assigned_branch_id=2 AND is_deleted=0 AND team_lead_id IS NULL",
        (ids["tl.ajah@bliss.com"],),
    )

    conn.commit()
    print("Phase 6 demo seed complete.")
    print(f"Teams: Ikeja Team Alpha (id={t1}), Ajah Team (id={t2})")
    print("Test credentials generated for this run (shown once):")
    for email, _, role_id, branch_id, _, _ in staff:
        print(f"  {email} / {TEST_PASSWORDS.get(email, '(unchanged existing account)')} · role_id={role_id} · branch_id={branch_id}")
    conn.close()


if __name__ == "__main__":
    seed()
