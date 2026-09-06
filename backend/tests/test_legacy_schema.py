"""A column the ORM stopped writing must not survive to reject every INSERT.

Startup against a legacy database is a process-level concern — the engine and
its DATABASE_URL are module singletons — so each case runs in its own
interpreter. That also keeps it from touching the database the rest of the
suite shares.
"""
import json
import subprocess
import sys
import tempfile
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]

# Exactly what the pre-RBAC `create_all` produced: NOT NULL with no SQL default,
# because SQLAlchemy's `default=False` is applied in Python and never in DDL.
_LEGACY_USERS = """
CREATE TABLE users (
    id INTEGER NOT NULL PRIMARY KEY,
    username VARCHAR(64) NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    is_active BOOLEAN,
    created_at DATETIME,
    is_admin BOOLEAN NOT NULL,
    organization_id INTEGER NOT NULL DEFAULT 1,
    role VARCHAR(40) NOT NULL DEFAULT 'UNIT_USER',
    can_delete_data BOOLEAN NOT NULL DEFAULT 0,
    token_version INTEGER NOT NULL DEFAULT 0,
    must_change_password BOOLEAN NOT NULL DEFAULT 0,
    is_root BOOLEAN NOT NULL DEFAULT 0,
    updated_at DATETIME
)
"""

_SCRIPT = """
import json, os, sqlite3, sys
db = sys.argv[1]
os.environ["DATABASE_URL"] = "sqlite:///" + db
os.environ["ADMIN_USERNAME"] = "root"
os.environ["ADMIN_PASSWORD"] = "root-pass-legacy"

from app.models import SessionLocal, User, engine, init_db
from app.security import hash_password
from sqlalchemy import text

init_db()

# Put the legacy shape back, carrying one account that was flagged is_admin.
with engine.begin() as conn:
    conn.execute(text("ALTER TABLE users RENAME TO users_old"))
    conn.execute(text(%(legacy)r))
    conn.execute(text(
        "INSERT INTO users (id,username,password_hash,is_active,created_at,is_admin,"
        "organization_id,role,can_delete_data,token_version,must_change_password,is_root) "
        "SELECT id,username,password_hash,is_active,created_at,0,organization_id,role,"
        "can_delete_data,token_version,must_change_password,is_root FROM users_old"
    ))
    conn.execute(text("DROP TABLE users_old"))
    conn.execute(text(
        "INSERT INTO users (username,password_hash,is_active,is_admin,organization_id,role) "
        "VALUES ('legacy-admin','x',1,1,1,'UNIT_USER')"
    ))

def columns():
    with engine.connect() as conn:
        return {row[1] for row in conn.execute(text("PRAGMA table_info(users)"))}

before = "is_admin" in columns()
init_db()  # what the service does as it comes up
after = "is_admin" in columns()

db_session = SessionLocal()
try:
    db_session.add(User(username="after-upgrade", password_hash=hash_password("a-long-password"),
                        organization_id=1, role="UNIT_MANAGER"))
    db_session.commit()
    insert_ok = True
except Exception as exc:
    insert_ok = repr(exc)
finally:
    db_session.close()

db_session = SessionLocal()
try:
    revived = db_session.query(User).filter(User.username == "legacy-admin").first()
    result = {
        "column_before": before,
        "column_after": after,
        "insert_ok": insert_ok,
        "revived_role": revived.role if revived else None,
        "revived_can_delete": bool(revived.can_delete_data) if revived else None,
    }
finally:
    db_session.close()
print("RESULT" + json.dumps(result))
""" % {"legacy": _LEGACY_USERS}


def _run() -> dict:
    with tempfile.TemporaryDirectory() as tmp:
        db = str(Path(tmp) / "legacy.db")
        proc = subprocess.run(
            [sys.executable, "-c", _SCRIPT, db],
            cwd=BACKEND, capture_output=True, text=True,
        )
        assert proc.returncode == 0, proc.stderr
        line = next(l for l in proc.stdout.splitlines() if l.startswith("RESULT"))
        return json.loads(line[len("RESULT"):])


def test_startup_drops_the_legacy_column_and_writes_still_work():
    result = _run()
    assert result["column_before"] is True
    assert result["column_after"] is False
    assert result["insert_ok"] is True, result["insert_ok"]


def test_the_old_flag_becomes_a_role_before_the_column_is_dropped():
    result = _run()
    assert result["revived_role"] == "UNIT_MANAGER"
    assert result["revived_can_delete"] is True
