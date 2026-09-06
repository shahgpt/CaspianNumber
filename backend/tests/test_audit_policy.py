"""Audit-log policy: reads stay on the record without burying the changes."""
import os
import tempfile
import uuid

os.environ.setdefault("DATABASE_URL", f"sqlite:///{tempfile.mkdtemp()}/test.db")
os.environ.setdefault("ADMIN_USERNAME", "root")
os.environ.setdefault("ADMIN_PASSWORD", "root-pass")

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.models import ChangeLog, Employee, Organization, SessionLocal, User, init_db

client = TestClient(app)


@pytest.fixture(autouse=True)
def clean_created_rows():
    init_db()
    db = SessionLocal()
    try:
        before = {
            ChangeLog: {row[0] for row in db.query(ChangeLog.id).all()},
            Employee: {row[0] for row in db.query(Employee.id).all()},
            User: {row[0] for row in db.query(User.id).all()},
            Organization: {row[0] for row in db.query(Organization.id).all()},
        }
    finally:
        db.close()
    yield
    db = SessionLocal()
    try:
        for model in (ChangeLog, Employee, User, Organization):
            ids = before[model]
            query = db.query(model)
            if ids:
                query = query.filter(~model.id.in_(ids))
            query.delete(synchronize_session=False)
        db.commit()
    finally:
        db.close()


def _headers(username: str, password: str) -> dict:
    response = client.post("/api/auth/login", json={"username": username, "password": password})
    assert response.status_code == 200, response.text
    return {"Authorization": f"Bearer {response.json()['access_token']}"}


def _count(action: str) -> int:
    db = SessionLocal()
    try:
        return db.query(ChangeLog).filter(ChangeLog.action == action).count()
    finally:
        db.close()


def _latest(action: str) -> ChangeLog | None:
    db = SessionLocal()
    try:
        return (
            db.query(ChangeLog)
            .filter(ChangeLog.action == action)
            .order_by(ChangeLog.id.desc())
            .first()
        )
    finally:
        db.close()


def test_repeated_directory_searches_collapse_into_one_row():
    with client:
        headers = _headers("root", "root-pass")
        before = _count("DIRECTORY_VIEW")
        for i in range(10):
            assert client.get(f"/api/employees?q=a{i}", headers=headers).status_code == 200
        assert _count("DIRECTORY_VIEW") - before == 1

        row = _latest("DIRECTORY_VIEW")
        assert row is not None
        # The record still says it happened, and how often.
        assert row.details["repeats"] == 10


def test_opening_the_audit_log_writes_nothing():
    with client:
        headers = _headers("root", "root-pass")
        db = SessionLocal()
        try:
            before = db.query(ChangeLog).count()
        finally:
            db.close()

        for _ in range(3):
            assert client.get("/api/admin/logs", headers=headers).status_code == 200

        db = SessionLocal()
        try:
            assert db.query(ChangeLog).count() == before
        finally:
            db.close()


def test_admin_list_views_are_recorded_but_collapsed():
    with client:
        headers = _headers("root", "root-pass")
        before = _count("SENSITIVE_LIST_VIEW")
        for _ in range(5):
            assert client.get("/api/admin/users", headers=headers).status_code == 200
        assert _count("SENSITIVE_LIST_VIEW") - before == 1
        assert _latest("SENSITIVE_LIST_VIEW").details["repeats"] == 5


def test_nobody_can_change_their_own_access_level():
    with client:
        headers = _headers("root", "root-pass")
        me = client.get("/api/auth/me", headers=headers).json()
        blocked = client.patch(
            f"/api/admin/users/{me['id']}/role",
            headers=headers,
            json={"role": "GLOBAL_ADMIN", "can_delete_data": True},
        )
        assert blocked.status_code == 400

        db = SessionLocal()
        try:
            assert db.get(User, me["id"]).role == "GLOBAL_ADMIN"
        finally:
            db.close()


def test_role_change_records_who_gave_what_to_whom():
    with client:
        headers = _headers("root", "root-pass")
        username = f"grantee-{uuid.uuid4().hex[:8]}"
        orgs = client.get("/api/admin/organizations", headers=headers).json()
        head_id = next(o["id"] for o in orgs if o["kind"] == "HEAD_OFFICE")
        created = client.post(
            "/api/admin/users", headers=headers,
            json={"username": username, "role": "UNIT_USER", "organization_id": head_id},
        )
        assert created.status_code == 200, created.text
        target_id = client.get("/api/admin/users", headers=headers).json()
        target_id = next(u["id"] for u in target_id if u["username"] == username)

        promoted = client.patch(
            f"/api/admin/users/{target_id}/role",
            headers=headers,
            json={"role": "UNIT_MANAGER", "can_delete_data": True},
        )
        assert promoted.status_code == 200, promoted.text

        row = _latest("ROLE_CHANGED")
        assert row is not None
        assert row.actor_name == "root"
        assert row.target_user_id == target_id
        assert row.role_before == "UNIT_USER"
        assert row.role_after == "UNIT_MANAGER"
        assert row.at is not None
