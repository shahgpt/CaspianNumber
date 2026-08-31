"""صفحه‌بندی فهرست همکاران — اسکرول بی‌نهایت وقتی درست است که صفحه‌ها
نه تکرار شوند و نه کسی را جا بیندازند.

اجرا:  backend/.venv/bin/python -m pytest tests -q
"""
import os
import tempfile

os.environ.setdefault("DATABASE_URL", f"sqlite:///{tempfile.mkdtemp()}/test.db")
os.environ.setdefault("ADMIN_USERNAME", "root")
os.environ.setdefault("ADMIN_PASSWORD", "root-pass")

from fastapi.testclient import TestClient  # noqa: E402

from app.main import app, startup  # noqa: E402
from app.models import Employee, SessionLocal  # noqa: E402

startup()
client = TestClient(app)

ADDED = 75
_seeded = False


def _auth() -> dict:
    res = client.post(
        "/api/auth/login",
        json={
            "username": os.environ["ADMIN_USERNAME"],
            "password": os.environ["ADMIN_PASSWORD"],
        },
    )
    assert res.status_code == 200, res.text
    return {"Authorization": f"Bearer {res.json()['access_token']}"}


def _seed() -> int:
    """چند ردیف اضافه می‌کند و شمارِ کلِ جدول را برمی‌گرداند."""
    global _seeded
    db = SessionLocal()
    try:
        if not _seeded:
            for i in range(ADDED):
                # نام خانوادگی عمداً تکراری است تا مرتب‌سازیِ ناپایدار لو برود
                emp = Employee(
                    first_name=f"همکار{i}",
                    last_name="کاسپین" if i % 2 else "دریا",
                    department="شبکه",
                    extension=str(200 + i),
                )
                emp.rebuild_search_text()
                db.add(emp)
            db.commit()
            _seeded = True
        return db.query(Employee).count()
    finally:
        db.close()


def _ids(**params) -> list[int]:
    res = client.get("/api/employees", params=params, headers=_auth())
    assert res.status_code == 200, res.text
    return [row["id"] for row in res.json()]


def test_browse_pages_are_disjoint_and_complete():
    total = _seed()
    seen: list[int] = []
    offset = 0
    while True:
        page = _ids(limit=30, offset=offset)
        if not page:
            break
        seen += page
        offset += 30
    assert len(seen) == total
    assert len(set(seen)) == total


def test_search_pages_are_disjoint():
    _seed()
    first = _ids(q="شبکه", limit=10)
    second = _ids(q="شبکه", limit=10, offset=10)
    assert len(first) == 10
    assert len(second) == 10
    assert not set(first) & set(second)
