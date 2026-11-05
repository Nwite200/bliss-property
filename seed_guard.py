"""Fail-closed environment guard for seed and wipe scripts.

The scripts that use this module can write destructive data, so they must know
exactly which database they are pointed at. We never infer "probably safe".
Set SEED_ENV=local or SEED_ENV=staging explicitly.

Local:  db_path must be an existing SQLite file inside the Wrangler D1 state
        directory. The database identifier is the file path.

Staging: the database ID must match the known staging D1 UUID exactly, and the
        caller must use the remote Wrangler target. Any other ID is refused.

Anything else (including a blank or misspelled SEED_ENV) fails closed.
"""

import os
import sys

STAGING_DB_ID = "294d118f-96c1-4878-ad56-a33d0b866958"
# Add production database IDs here when they become known. Even without them,
# staging refuses any ID other than STAGING_DB_ID, so production cannot match.
PRODUCTION_DB_IDS = {
    value.strip()
    for value in os.environ.get("PRODUCTION_DB_IDS", "").split(",")
    if value.strip()
}

LOCAL_D1_MARKER = "/.wrangler/state/v3/d1/"


def _fail(message):
    print(f"REFUSED: {message}", file=sys.stderr)
    raise SystemExit(2)


def _environment():
    env = (os.environ.get("SEED_ENV") or "").strip().lower()
    if env not in ("local", "staging"):
        _fail("set SEED_ENV=local or SEED_ENV=staging explicitly")
    declared = (os.environ.get("ENVIRONMENT") or "").strip().lower()
    if declared and declared != env:
        _fail(f"SEED_ENV={env} contradicts ENVIRONMENT={declared}")
    return env


def require_local(script_name, db_path):
    env = _environment()
    if env != "local":
        _fail(f"{script_name} is using a local SQLite path but SEED_ENV={env}")
    path = os.path.abspath(db_path).replace("\\", "/")
    if LOCAL_D1_MARKER not in path:
        _fail("database path is not inside the local Wrangler D1 state directory")
    if not os.path.isfile(path):
        _fail("local database file does not exist")
    if "prod" in path.lower():
        _fail("database path looks like production")
    if any(prod_id in path for prod_id in PRODUCTION_DB_IDS):
        _fail("database path matches a configured production database ID")
    return env


def require_staging(script_name, database_id, target):
    env = _environment()
    if env != "staging":
        _fail(f"{script_name} remote target requires SEED_ENV=staging, got {env}")
    if target != "remote":
        _fail("staging writes must use the remote Wrangler target")
    identifier = (database_id or "").strip()
    if not identifier:
        _fail("staging database ID is missing")
    if identifier in PRODUCTION_DB_IDS:
        _fail("database ID is marked as production")
    if identifier != STAGING_DB_ID:
        _fail(
            "database ID does not match the known staging database; "
            "refusing to write to an unknown database"
        )
    return env
