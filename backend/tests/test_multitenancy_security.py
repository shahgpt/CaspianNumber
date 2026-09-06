"""Adversarial tenant-isolation and privilege tests."""
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
    ORG_FACTORY, ROLE_GLOBAL_ADMIN, ROLE_HEAD_OFFICE_ACCESS_ADMIN, ROLE_UNIT_MANAGER, ROLE_UNIT_USER,
    ChangeLog, Employee, Organization, SessionLocal, User, init_db,
)
from app.security import hash_password

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


def _name(prefix: str) -> str:
    return f"{prefix}-{uuid.uuid4().hex[:8]}"


def _login(username: str, password: str) -> dict:
    response = client.post("/api/auth/login", json={"username": username, "password": password})
    assert response.status_code == 200, response.text
    return response.json()


def _headers(username: str, password: str) -> dict:
    token = _login(username, password)["access_token"]
    return {"Authorization": f"Bearer {token}"}


def _seed_two_units():
    db = SessionLocal()
    try:
        a = Organization(name=_name("کارخانه الف"), code=_name("A").upper(), kind=ORG_FACTORY)
        b = Organization(name=_name("کارخانه ب"), code=_name("B").upper(), kind=ORG_FACTORY)
        db.add_all([a, b]); db.flush()
        ua, ub = _name("manager-a"), _name("manager-b")
        db.add_all([
            User(username=ua, password_hash=hash_password("manager-pass-a"), organization_id=a.id,
                 role=ROLE_UNIT_MANAGER, can_delete_data=True),
            User(username=ub, password_hash=hash_password("manager-pass-b"), organization_id=b.id,
                 role=ROLE_UNIT_MANAGER, can_delete_data=True),
        ])
        ea = Employee(organization_id=a.id, first_name="الف", last_name="مجاز", extension="100")
        eb = Employee(organization_id=b.id, first_name="ب", last_name="محرمانه", extension="200")
        ea.rebuild_search_text(); eb.rebuild_search_text()
        db.add_all([ea, eb]); db.commit()
        return a.id, b.id, ua, ub, ea.id, eb.id
    finally:
        db.close()


def test_url_query_id_and_body_cannot_cross_tenants():
    with client:
        a_id, b_id, ua, _, ea_id, eb_id = _seed_two_units()
        headers = _headers(ua, "manager-pass-a")

        listed = client.get("/api/employees", headers=headers)
        assert listed.status_code == 200
        assert {row["organization_id"] for row in listed.json()} == {a_id}
        assert eb_id not in {row["id"] for row in listed.json()}

        assert client.get(f"/api/employees?organization_id={b_id}", headers=headers).status_code == 404
        assert client.get(f"/api/admin/employees?organization_id={b_id}", headers=headers).status_code == 404
        assert client.get(f"/api/employees/{eb_id}/vcard", headers=headers).status_code == 404

        attack = {"first_name": "سرقت", "organization_id": b_id}
        assert client.patch(f"/api/admin/employees/{eb_id}", json=attack, headers=headers).status_code == 422
        assert client.post("/api/admin/employees", json=attack, headers=headers).status_code == 422

        mixed = client.post("/api/admin/employees/bulk-delete", json={"ids": [ea_id, eb_id]}, headers=headers)
        assert mixed.status_code == 404
        db = SessionLocal()
        try:
            assert db.get(Employee, ea_id) is not None and db.get(Employee, eb_id) is not None
        finally:
            db.close()


def test_factory_manager_cannot_choose_another_org_or_create_global_admin():
    with client:
        a_id, b_id, ua, _, _, _ = _seed_two_units()
        headers = _headers(ua, "manager-pass-a")
        foreign = client.post("/api/admin/users", headers=headers, json={
            "username": _name("foreign"), "organization_id": b_id, "role": ROLE_UNIT_USER,
        })
        assert foreign.status_code == 404

        escalation = client.post("/api/admin/users", headers=headers, json={
            "username": _name("global"), "organization_id": a_id, "role": ROLE_GLOBAL_ADMIN,
        })
        # A factory is not the head office, so the role has nowhere to live there.
        assert escalation.status_code == 400


def test_head_office_is_not_a_parent_tenant_and_only_root_grants_the_global_role():
    with client:
        a_id, b_id, _, _, ea_id, eb_id = _seed_two_units()
        db = SessionLocal()
        try:
            head_id = db.query(Organization).filter(Organization.kind == "HEAD_OFFICE").first().id
            username = _name("hq-manager")
            db.add(User(username=username, password_hash=hash_password("head-office-pass"),
                        organization_id=head_id, role=ROLE_UNIT_MANAGER, can_delete_data=True))
            db.commit()
        finally:
            db.close()
        headers = _headers(username, "head-office-pass")

        # Being in the head office grants nothing over the factories.
        hq_rows = client.get("/api/employees", headers=headers)
        assert hq_rows.status_code == 200
        assert ea_id not in {row["id"] for row in hq_rows.json()}
        assert eb_id not in {row["id"] for row in hq_rows.json()}
        assert client.get(f"/api/employees?organization_id={a_id}", headers=headers).status_code == 404
        assert client.get(f"/api/employees?organization_id={b_id}", headers=headers).status_code == 404

        escalation = client.post("/api/admin/users", headers=headers, json={
            "username": _name("forbidden-global"), "role": ROLE_GLOBAL_ADMIN,
        })
        assert escalation.status_code == 403

        db = SessionLocal()
        try:
            privileged = User(
                username=_name("head-office-access-admin"), password_hash=hash_password("privileged-pass"),
                organization_id=head_id, role=ROLE_HEAD_OFFICE_ACCESS_ADMIN,
                can_delete_data=True,
            )
            db.add(privileged); db.commit(); privileged_id = privileged.id
        finally:
            db.close()
        assert client.post(
            f"/api/admin/users/{privileged_id}/reset-password", headers=headers,
        ).status_code == 403
        assert client.patch(
            f"/api/admin/users/{privileged_id}/credentials", headers=headers,
            json={"username": _name("taken-over"), "password": "attacker-password"},
        ).status_code == 403
        assert client.post(
            f"/api/admin/users/{privileged_id}/toggle-active", headers=headers,
        ).status_code == 403
        assert client.patch(
            f"/api/admin/users/{privileged_id}/role", headers=headers,
            json={"role": ROLE_UNIT_USER, "can_delete_data": False},
        ).status_code == 403


def test_self_escalation_is_rejected_and_role_change_is_audited():
    with client:
        root = _headers("root", "root-pass")
        me = client.get("/api/auth/me", headers=root).json()
        self_change = client.patch(f"/api/admin/users/{me['id']}/role", headers=root, json={
            "role": ROLE_GLOBAL_ADMIN, "can_delete_data": True,
        })
        assert self_change.status_code == 400

        head_id = client.get("/api/admin/organizations", headers=root).json()
        head_id = next(o["id"] for o in head_id if o["kind"] == "HEAD_OFFICE")
        created = client.post("/api/admin/users", headers=root,
                              json={"username": _name("hq-user"), "organization_id": head_id})
        assert created.status_code == 200, created.text
        target = created.json()
        changed = client.patch(f"/api/admin/users/{target['id']}/role", headers=root, json={
            "role": ROLE_GLOBAL_ADMIN, "can_delete_data": True,
        })
        assert changed.status_code == 200, changed.text
        logs = client.get("/api/admin/logs?limit=500", headers=root).json()
        row = next(item for item in logs if item["action"] == "ROLE_CHANGED" and item["target_user_id"] == target["id"])
        assert row["role_before"] == ROLE_UNIT_USER
        assert row["role_after"] == ROLE_GLOBAL_ADMIN
        assert row["actor_name"] == "root"


def test_global_admin_can_view_all_units_or_one_unit():
    with client:
        a_id, b_id, _, _, _, _ = _seed_two_units()
        db = SessionLocal()
        try:
            head_id = db.query(Organization).filter(Organization.kind == "HEAD_OFFICE").first().id
            username = _name("global")
            db.add(User(username=username, password_hash=hash_password("global-password"),
                        organization_id=head_id, role=ROLE_GLOBAL_ADMIN, can_delete_data=True))
            db.commit()
        finally:
            db.close()

        # A plain username/password login is the whole gate, for every role.
        login = _login(username, "global-password")
        assert login["access_token"]
        headers = {"Authorization": f"Bearer {login['access_token']}"}

        all_rows = client.get("/api/employees", headers=headers)
        assert all_rows.status_code == 200
        assert {a_id, b_id}.issubset({row["organization_id"] for row in all_rows.json()})
        db = SessionLocal()
        try:
            global_view = db.query(ChangeLog).filter(
                ChangeLog.actor_name == username,
                ChangeLog.action == "DIRECTORY_VIEW",
            ).order_by(ChangeLog.id.desc()).first()
            assert global_view is not None and global_view.organization_id is None
        finally:
            db.close()
        # An all-units read belongs to no unit, so a unit-scoped log view must
        # not pick it up.
        head_id = next(o["id"] for o in client.get("/api/admin/organizations", headers=headers).json()
                       if o["kind"] == "HEAD_OFFICE")
        hq_logs = client.get(f"/api/admin/logs?limit=500&organization_id={head_id}", headers=headers)
        assert hq_logs.status_code == 200
        assert not any(
            row["actor_name"] == username and row["action"] == "DIRECTORY_VIEW"
            for row in hq_logs.json()
        )
        one = client.get(f"/api/employees?organization_id={a_id}", headers=headers)
        assert one.status_code == 200
        assert {row["organization_id"] for row in one.json()} == {a_id}

        ambiguous_write = client.post("/api/admin/employees", headers=headers, json={"first_name": "نامشخص"})
        assert ambiguous_write.status_code == 400
        scoped_write = client.post(
            f"/api/admin/employees?organization_id={a_id}", headers=headers,
            json={"first_name": "انتخاب‌شده", "extension": "301"},
        )
        assert scoped_write.status_code == 200, scoped_write.text
        assert scoped_write.json()["organization_id"] == a_id


def test_only_the_root_account_can_grant_the_global_role():
    """The right to mint global admins must not itself be grantable."""
    with client:
        db = SessionLocal()
        try:
            head_id = db.query(Organization).filter(Organization.kind == "HEAD_OFFICE").first().id
            grantee = _name("hq-access-admin")
            db.add(User(username=grantee, password_hash=hash_password("access-admin-pass"),
                        organization_id=head_id, role=ROLE_HEAD_OFFICE_ACCESS_ADMIN,
                        can_delete_data=True))
            db.commit()
        finally:
            db.close()

        # A head-office access admin is the highest non-root role, and still cannot.
        headers = _headers(grantee, "access-admin-pass")
        blocked = client.post("/api/admin/users", headers=headers, json={
            "username": _name("wannabe-global"), "organization_id": head_id,
            "role": ROLE_GLOBAL_ADMIN,
        })
        assert blocked.status_code == 403

        # There is no request shape that turns another account into a granter.
        assert client.patch(
            f"/api/admin/users/{client.get('/api/admin/users', headers=headers).json()[0]['id']}/role",
            headers=headers, json={"role": ROLE_GLOBAL_ADMIN, "can_delete_data": True, "is_root": True},
        ).status_code == 422

        root = _headers("root", "root-pass")
        allowed = client.post("/api/admin/users", headers=root, json={
            "username": _name("blessed-global"), "organization_id": head_id,
            "role": ROLE_GLOBAL_ADMIN,
        })
        assert allowed.status_code == 200, allowed.text
        assert allowed.json()["is_root"] is False


def test_root_account_cannot_be_taken_over_or_disabled():
    with client:
        db = SessionLocal()
        try:
            head_id = db.query(Organization).filter(Organization.kind == "HEAD_OFFICE").first().id
            attacker = _name("hq-attacker")
            db.add(User(username=attacker, password_hash=hash_password("attacker-pass"),
                        organization_id=head_id, role=ROLE_HEAD_OFFICE_ACCESS_ADMIN,
                        can_delete_data=True))
            db.commit()
            root_id = db.query(User).filter(User.username == "root").first().id
        finally:
            db.close()
        headers = _headers(attacker, "attacker-pass")

        assert client.patch(f"/api/admin/users/{root_id}/credentials", headers=headers,
                            json={"username": _name("stolen"), "password": "attacker-password"}).status_code == 403
        assert client.post(f"/api/admin/users/{root_id}/reset-password", headers=headers).status_code == 403
        assert client.post(f"/api/admin/users/{root_id}/toggle-active", headers=headers).status_code == 403
        assert client.patch(f"/api/admin/users/{root_id}/role", headers=headers,
                            json={"role": ROLE_UNIT_USER, "can_delete_data": False}).status_code == 403

        # Not even the root account may switch itself off and strand the system.
        root = _headers("root", "root-pass")
        assert client.post(f"/api/admin/users/{root_id}/toggle-active", headers=root).status_code == 400


def test_head_office_only_roles_are_refused_for_a_factory():
    """The bug: the panel offered a head-office role while scoped to a factory."""
    with client:
        a_id, _, _, _, _, _ = _seed_two_units()
        root = _headers("root", "root-pass")
        for role in (ROLE_HEAD_OFFICE_ACCESS_ADMIN, ROLE_GLOBAL_ADMIN):
            refused = client.post("/api/admin/users", headers=root, json={
                "username": _name("factory-elevated"), "organization_id": a_id, "role": role,
            })
            assert refused.status_code == 400, f"{role}: {refused.text}"


def test_deleting_an_account_keeps_what_that_account_did():
    with client:
        root = _headers("root", "root-pass")
        head_id = next(o["id"] for o in client.get("/api/admin/organizations", headers=root).json()
                       if o["kind"] == "HEAD_OFFICE")
        username = _name("temp-hire")
        created = client.post("/api/admin/users", headers=root,
                              json={"username": username, "organization_id": head_id})
        assert created.status_code == 200, created.text
        target_id = created.json()["id"]

        removed = client.delete(f"/api/admin/users/{target_id}", headers=root)
        assert removed.status_code == 200, removed.text
        assert client.delete(f"/api/admin/users/{target_id}", headers=root).status_code == 404

        db = SessionLocal()
        try:
            assert db.get(User, target_id) is None
            # Their creation is still on the record, with the actor's name intact.
            trail = db.query(ChangeLog).filter(
                ChangeLog.target_user_id == target_id,
            ).order_by(ChangeLog.id).all()
            assert [row.action for row in trail] == ["USER_CREATED", "USER_DELETED"]
            assert all(row.actor_name == "root" for row in trail)
        finally:
            db.close()


def test_neither_yourself_nor_the_root_account_can_be_deleted():
    with client:
        root = _headers("root", "root-pass")
        me = client.get("/api/auth/me", headers=root).json()
        assert client.delete(f"/api/admin/users/{me['id']}", headers=root).status_code == 400

        db = SessionLocal()
        try:
            head_id = db.query(Organization).filter(Organization.kind == "HEAD_OFFICE").first().id
            attacker = _name("hq-access")
            db.add(User(username=attacker, password_hash=hash_password("attacker-pass"),
                        organization_id=head_id, role=ROLE_HEAD_OFFICE_ACCESS_ADMIN,
                        can_delete_data=True))
            db.commit()
            root_id = db.query(User).filter(User.username == "root").first().id
        finally:
            db.close()
        assert client.delete(f"/api/admin/users/{root_id}",
                             headers=_headers(attacker, "attacker-pass")).status_code == 403


def test_deleting_an_account_needs_the_delete_permission():
    with client:
        a_id, _, _, _, _, _ = _seed_two_units()
        db = SessionLocal()
        try:
            weak = _name("no-delete-manager")
            db.add(User(username=weak, password_hash=hash_password("weak-pass"),
                        organization_id=a_id, role=ROLE_UNIT_MANAGER, can_delete_data=False))
            victim = User(username=_name("victim"), password_hash=hash_password("victim-pass"),
                          organization_id=a_id, role=ROLE_UNIT_USER)
            db.add(victim); db.commit(); victim_id = victim.id
        finally:
            db.close()
        assert client.delete(f"/api/admin/users/{victim_id}",
                             headers=_headers(weak, "weak-pass")).status_code == 403
