"""Unit types are data, and units can be removed — within the rules that keep
the head office and the elevated roles that live in it intact."""
import os
import tempfile
import uuid

os.environ.setdefault("DATABASE_URL", f"sqlite:///{tempfile.mkdtemp()}/test.db")
os.environ.setdefault("ADMIN_USERNAME", "root")
os.environ.setdefault("ADMIN_PASSWORD", "root-pass")

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.models import (
    ORG_FACTORY, ROLE_UNIT_MANAGER, ChangeLog, Employee, Organization,
    OrganizationKind, SessionLocal, User, init_db,
)
from app.security import hash_password

client = TestClient(app)
ROOT = {"username": "root", "password": "root-pass"}


@pytest.fixture(autouse=True)
def clean_created_rows():
    init_db()
    db = SessionLocal()
    try:
        before = {
            model: {row[0] for row in db.query(model.id).all()}
            for model in (ChangeLog, Employee, User, Organization, OrganizationKind)
        }
    finally:
        db.close()
    yield
    db = SessionLocal()
    try:
        for model in (ChangeLog, Employee, User, Organization, OrganizationKind):
            query = db.query(model)
            if before[model]:
                query = query.filter(~model.id.in_(before[model]))
            query.delete(synchronize_session=False)
        db.commit()
    finally:
        db.close()


def _name(prefix: str) -> str:
    return f"{prefix}-{uuid.uuid4().hex[:8]}"


def _root_headers() -> dict:
    res = client.post("/api/auth/login", json=ROOT)
    assert res.status_code == 200, res.text
    return {"Authorization": f"Bearer {res.json()['access_token']}"}


def _make_unit(headers: dict, kind: str = ORG_FACTORY) -> dict:
    res = client.post("/api/admin/organizations", headers=headers, json={
        "name": _name("واحد"), "code": _name("U").upper().replace("-", ""), "kind": kind,
    })
    assert res.status_code == 200, res.text
    return res.json()


def test_system_kinds_are_seeded_and_protected():
    with client:
        headers = _root_headers()
        kinds = client.get("/api/admin/organization-kinds", headers=headers)
        assert kinds.status_code == 200
        by_code = {k["code"]: k for k in kinds.json()}
        assert {"HEAD_OFFICE", "FACTORY"} <= by_code.keys()
        assert by_code["HEAD_OFFICE"]["is_system"] and by_code["FACTORY"]["is_system"]

        head = by_code["HEAD_OFFICE"]
        # Renaming the label is allowed; moving the code out from under the
        # role rules is not.
        renamed = client.patch(f"/api/admin/organization-kinds/{head['id']}",
                               headers=headers, json={"name": "ستاد مرکزی"})
        assert renamed.status_code == 200, renamed.text
        assert renamed.json()["name"] == "ستاد مرکزی"
        assert renamed.json()["code"] == "HEAD_OFFICE"

        recoded = client.patch(f"/api/admin/organization-kinds/{head['id']}",
                               headers=headers, json={"code": "HQ"})
        assert recoded.status_code == 400

        removed = client.delete(f"/api/admin/organization-kinds/{head['id']}", headers=headers)
        assert removed.status_code == 400

        # Put the shipped label back so the rest of the suite sees it.
        client.patch(f"/api/admin/organization-kinds/{head['id']}",
                     headers=headers, json={"name": "دفتر مرکزی"})


def test_custom_kind_round_trip_and_use_by_a_unit():
    with client:
        headers = _root_headers()
        code = _name("WH").upper().replace("-", "")
        created = client.post("/api/admin/organization-kinds", headers=headers,
                              json={"name": _name("انبار"), "code": code})
        assert created.status_code == 200, created.text
        kind_id = created.json()["id"]
        assert created.json()["is_system"] is False
        assert created.json()["usage_count"] == 0

        duplicate = client.post("/api/admin/organization-kinds", headers=headers,
                                json={"name": _name("انبار"), "code": code})
        assert duplicate.status_code == 400

        unit = _make_unit(headers, kind=code)
        assert unit["kind"] == code

        listed = {k["id"]: k for k in client.get("/api/admin/organization-kinds", headers=headers).json()}
        assert listed[kind_id]["usage_count"] == 1

        # In use: it cannot be dropped out from under the unit that carries it.
        assert client.delete(f"/api/admin/organization-kinds/{kind_id}", headers=headers).status_code == 400

        # Renaming the code carries every unit with it.
        new_code = _name("ST").upper().replace("-", "")
        moved = client.patch(f"/api/admin/organization-kinds/{kind_id}",
                             headers=headers, json={"code": new_code})
        assert moved.status_code == 200, moved.text
        db = SessionLocal()
        try:
            assert db.get(Organization, unit["id"]).kind == new_code
        finally:
            db.close()

        # Freed, then removable.
        assert client.patch(f"/api/admin/organizations/{unit['id']}",
                            headers=headers, json={"kind": ORG_FACTORY}).status_code == 200
        assert client.delete(f"/api/admin/organization-kinds/{kind_id}", headers=headers).status_code == 200


def test_unknown_kind_is_rejected_on_create_and_update():
    with client:
        headers = _root_headers()
        bad = client.post("/api/admin/organizations", headers=headers, json={
            "name": _name("واحد"), "code": _name("X").upper().replace("-", ""), "kind": "NOPE",
        })
        assert bad.status_code == 400

        unit = _make_unit(headers)
        assert client.patch(f"/api/admin/organizations/{unit['id']}",
                            headers=headers, json={"kind": "NOPE"}).status_code == 400


def test_unit_delete_requires_it_to_be_empty():
    with client:
        headers = _root_headers()
        unit = _make_unit(headers)

        db = SessionLocal()
        try:
            emp = Employee(organization_id=unit["id"], first_name="الف", last_name="ب", extension="101")
            emp.rebuild_search_text()
            db.add(emp)
            db.commit()
            emp_id = emp.id
        finally:
            db.close()

        assert client.delete(f"/api/admin/organizations/{unit['id']}", headers=headers).status_code == 400

        assert client.delete(f"/api/admin/employees/{emp_id}?organization_id={unit['id']}",
                             headers=headers).status_code == 200

        db = SessionLocal()
        try:
            db.add(User(username=_name("m"), password_hash=hash_password("x" * 12),
                        organization_id=unit["id"], role=ROLE_UNIT_MANAGER))
            db.commit()
        finally:
            db.close()

        assert client.delete(f"/api/admin/organizations/{unit['id']}", headers=headers).status_code == 400

        db = SessionLocal()
        try:
            db.query(User).filter(User.organization_id == unit["id"]).delete(synchronize_session=False)
            db.commit()
        finally:
            db.close()

        removed = client.delete(f"/api/admin/organizations/{unit['id']}", headers=headers)
        assert removed.status_code == 200, removed.text
        db = SessionLocal()
        try:
            assert db.get(Organization, unit["id"]) is None
            # The trail survives its unit.
            orphaned = db.query(ChangeLog).filter(
                ChangeLog.entity == "organization", ChangeLog.entity_id == unit["id"]
            ).count()
            assert orphaned > 0
        finally:
            db.close()


def test_refusal_messages_count_in_persian_digits():
    """A Persian sentence with a Latin numeral in it is the only one on screen."""
    with client:
        headers = _root_headers()
        unit = _make_unit(headers)
        db = SessionLocal()
        try:
            for i in range(3):
                emp = Employee(organization_id=unit["id"], first_name="الف", last_name=str(i), extension=f"3{i}0")
                emp.rebuild_search_text()
                db.add(emp)
            db.commit()
        finally:
            db.close()

        refused = client.delete(f"/api/admin/organizations/{unit['id']}", headers=headers)
        assert refused.status_code == 400
        detail = refused.json()["detail"]
        assert "۳ پرسنل" in detail
        assert not any(ch.isdigit() and ch.isascii() for ch in detail)


def test_head_office_and_own_unit_are_not_deletable():
    with client:
        headers = _root_headers()
        db = SessionLocal()
        try:
            head = db.query(Organization).filter(Organization.kind == "HEAD_OFFICE").first()
            head_id = head.id
        finally:
            db.close()
        assert client.delete(f"/api/admin/organizations/{head_id}", headers=headers).status_code == 400
        # The head office also keeps its type while elevated accounts sit in it.
        assert client.patch(f"/api/admin/organizations/{head_id}",
                            headers=headers, json={"kind": ORG_FACTORY}).status_code == 400


def test_unit_manager_cannot_manage_kinds_or_units():
    with client:
        headers = _root_headers()
        unit = _make_unit(headers)
        username, password = _name("manager"), "manager-pass-1"
        db = SessionLocal()
        try:
            db.add(User(username=username, password_hash=hash_password(password),
                        organization_id=unit["id"], role=ROLE_UNIT_MANAGER, can_delete_data=True))
            db.commit()
        finally:
            db.close()
        res = client.post("/api/auth/login", json={"username": username, "password": password})
        manager = {"Authorization": f"Bearer {res.json()['access_token']}"}

        # Reading the vocabulary is fine — every list shows a unit's type.
        assert client.get("/api/admin/organization-kinds", headers=manager).status_code == 200
        assert client.post("/api/admin/organization-kinds", headers=manager,
                           json={"name": "x", "code": "XX"}).status_code == 403
        assert client.delete(f"/api/admin/organizations/{unit['id']}", headers=manager).status_code == 403
