"""The overview is the audit trail read back; these fix the arithmetic."""
import os
import tempfile
import uuid
from datetime import datetime, timedelta, timezone

os.environ.setdefault("DATABASE_URL", f"sqlite:///{tempfile.mkdtemp()}/test.db")
os.environ.setdefault("ADMIN_USERNAME", "root")
os.environ.setdefault("ADMIN_PASSWORD", "root-pass")

import pytest
from fastapi.testclient import TestClient

from app.analytics import build_overview
from app.core.config import settings
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


def _utc_naive(days_ago: float) -> datetime:
    """A timestamp `days_ago` days back, shaped like the rows the app writes."""
    return (datetime.now(timezone.utc) - timedelta(days=days_ago)).replace(tzinfo=None)


def _seed_unit_with_trail() -> tuple[int, int]:
    db = SessionLocal()
    try:
        org = Organization(name=_name("واحد"), code=_name("A").upper().replace("-", ""), kind=ORG_FACTORY)
        db.add(org); db.flush()
        emp = Employee(organization_id=org.id, first_name="مینا", last_name="رها", extension="101")
        emp.rebuild_search_text()
        db.add(emp); db.flush()

        rows = [
            # One directory read standing for five, inside the window.
            ChangeLog(organization_id=org.id, entity="employee", action="DIRECTORY_VIEW",
                      actor_id=None, actor_name="viewer", details={"query": "شبکه", "repeats": 5},
                      at=_utc_naive(1)),
            ChangeLog(organization_id=org.id, entity="employee", action="VCARD_VIEW",
                      entity_id=emp.id, actor_name="viewer", details=None, at=_utc_naive(1)),
            ChangeLog(organization_id=org.id, entity="auth", action="LOGIN_SUCCESS",
                      actor_name="viewer", details=None, at=_utc_naive(2)),
            ChangeLog(organization_id=org.id, entity="auth", action="LOGIN_FAILED",
                      actor_name="anonymous", details=None, at=_utc_naive(2)),
            ChangeLog(organization_id=org.id, entity="employee", action="UPDATE",
                      entity_id=emp.id, actor_name="editor", details={"first_name": {"from": "a", "to": "b"}},
                      at=_utc_naive(3)),
            # Outside a 7-day window, inside the one before it.
            ChangeLog(organization_id=org.id, entity="employee", action="DIRECTORY_VIEW",
                      actor_name="viewer", details={"repeats": 2}, at=_utc_naive(9)),
        ]
        db.add_all(rows)
        db.commit()
        return org.id, emp.id
    finally:
        db.close()


def test_counts_weight_folded_reads_and_split_windows():
    org_id, emp_id = _seed_unit_with_trail()
    db = SessionLocal()
    try:
        overview = build_overview(db, days=7, organization_id=org_id)
    finally:
        db.close()

    totals = overview["totals"]
    # 5 folded directory reads + 1 card view; the 9-day-old row is out of range.
    assert totals["directory_views"] == 5
    assert totals["card_views"] == 1
    assert totals["views"] == 6
    assert totals["searches"] == 5
    assert totals["logins"] == 1
    assert totals["failed_logins"] == 1
    assert totals["changes"] == 1

    # The preceding window of equal length holds only the older read.
    assert overview["previous"]["directory_views"] == 2

    assert len(overview["daily"]) == 7
    assert sum(day["views"] for day in overview["daily"]) == 6
    assert sum(day["logins"] for day in overview["daily"]) == 1
    assert sum(day["changes"] for day in overview["daily"]) == 1

    assert sum(h["views"] for h in overview["hourly"]) == 6
    assert sum(d["views"] for d in overview["weekday"]) == 6
    assert overview["top_queries"] == [{"term": "شبکه", "count": 5}]
    assert overview["top_people"] == [{"id": emp_id, "name": "مینا رها", "count": 1}]
    assert overview["by_unit"][0]["views"] == 6
    assert overview["directory"]["employees"] == 1


def test_days_are_bucketed_in_the_report_timezone():
    """A row just after local midnight belongs to the local day, not the UTC one."""
    offset = timedelta(minutes=settings.REPORT_UTC_OFFSET_MINUTES)
    now_local = datetime.now(timezone.utc) + offset
    # Skip when local midnight is less than an hour old: "half an hour into
    # today" would then be in the future, which is not what this asserts.
    if now_local.hour == 0 and now_local.minute < 40:
        pytest.skip("too close to local midnight for this assertion to mean anything")
    just_after_midnight_local = now_local.replace(hour=0, minute=30, second=0, microsecond=0)
    stored = (just_after_midnight_local - offset).replace(tzinfo=None)

    db = SessionLocal()
    try:
        org = Organization(name=_name("واحد"), code=_name("B").upper().replace("-", ""), kind=ORG_FACTORY)
        db.add(org); db.flush()
        db.add(ChangeLog(organization_id=org.id, entity="employee", action="DIRECTORY_VIEW",
                         actor_name="viewer", details=None, at=stored))
        db.commit()
        overview = build_overview(db, days=3, organization_id=org.id)
    finally:
        db.close()

    today = just_after_midnight_local.date().isoformat()
    by_date = {day["date"]: day["views"] for day in overview["daily"]}
    assert by_date[today] == 1
    assert overview["hourly"][0]["views"] == 1


def test_endpoint_is_scoped_to_the_callers_unit():
    with client:
        headers = _root_headers()
        org_id, _ = _seed_unit_with_trail()

        username, password = _name("manager"), "manager-pass-1"
        db = SessionLocal()
        try:
            db.add(User(username=username, password_hash=hash_password(password),
                        organization_id=org_id, role=ROLE_UNIT_MANAGER))
            db.commit()
        finally:
            db.close()
        res = client.post("/api/auth/login", json={"username": username, "password": password})
        manager = {"Authorization": f"Bearer {res.json()['access_token']}"}

        scoped = client.get("/api/admin/analytics?days=7", headers=manager)
        assert scoped.status_code == 200, scoped.text
        assert scoped.json()["totals"]["directory_views"] == 5

        # Another unit's numbers are not reachable by asking for them.
        assert client.get("/api/admin/analytics?days=7&organization_id=1",
                          headers=manager).status_code == 404

        # The global admin sees every unit at once when none is selected.
        everything = client.get("/api/admin/analytics?days=7", headers=headers)
        assert everything.status_code == 200
        assert everything.json()["totals"]["views"] >= 6


def test_active_users_survives_a_deleted_account():
    """Deleting a user releases actor_id but keeps actor_name; their activity
    still belongs to a person, and must not vanish from the count."""
    db = SessionLocal()
    try:
        org = Organization(name=_name("واحد"), code=_name("C").upper().replace("-", ""), kind=ORG_FACTORY)
        db.add(org); db.flush()
        db.add_all([
            # A live account, twice: one person, not two.
            ChangeLog(organization_id=org.id, entity="employee", action="DIRECTORY_VIEW",
                      actor_id=1, actor_name="still-here", at=_utc_naive(1)),
            ChangeLog(organization_id=org.id, entity="employee", action="VCARD_VIEW",
                      actor_id=1, actor_name="still-here", at=_utc_naive(1)),
            # A departed account: id released, name kept.
            ChangeLog(organization_id=org.id, entity="employee", action="DIRECTORY_VIEW",
                      actor_id=None, actor_name="left-the-company", at=_utc_naive(1)),
            # A failed sign-in is nobody: it must not add a "user".
            ChangeLog(organization_id=org.id, entity="auth", action="LOGIN_FAILED",
                      actor_id=None, actor_name="anonymous", at=_utc_naive(1)),
        ])
        db.commit()
        overview = build_overview(db, days=7, organization_id=org.id)
    finally:
        db.close()

    assert overview["totals"]["active_users"] == 2


def test_day_window_is_clamped():
    db = SessionLocal()
    try:
        assert build_overview(db, days=0, organization_id=None)["range"]["days"] == 1
        assert build_overview(db, days=9999, organization_id=None)["range"]["days"] == 365
    finally:
        db.close()
