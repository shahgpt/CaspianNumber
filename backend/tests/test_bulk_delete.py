"""حذفِ دسته‌جمعیِ پرسنل — انتخاب چند نفر، یک تراکنش، یک سطرِ لاگ.

اجرا:  backend/.venv/bin/python -m pytest tests -q
"""
import os
import tempfile

os.environ["DATABASE_URL"] = f"sqlite:///{tempfile.mkdtemp()}/test.db"
os.environ["ADMIN_USERNAME"] = "root"
os.environ["ADMIN_PASSWORD"] = "root-pass"

from fastapi.testclient import TestClient  # noqa: E402

from app.main import app  # noqa: E402
from app.models import SessionLocal, User  # noqa: E402
from app.security import hash_password  # noqa: E402

client = TestClient(app)


def _admin_headers() -> dict:
    res = client.post("/api/auth/login", json={"username": "root", "password": "root-pass"})
    assert res.status_code == 200, res.text
    return {"Authorization": f"Bearer {res.json()['access_token']}"}


def _make(headers: dict, first: str) -> int:
    res = client.post(
        "/api/admin/employees",
        headers=headers,
        json={"first_name": first, "last_name": "آزمایشی", "extension": "1001"},
    )
    assert res.status_code == 200, res.text
    return res.json()["id"]


def test_bulk_delete_removes_only_the_chosen_ones():
    with client:
        h = _admin_headers()
        a, b, c = _make(h, "الف"), _make(h, "ب"), _make(h, "ج")

        res = client.post("/api/admin/employees/bulk-delete", headers=h, json={"ids": [a, b]})
        assert res.status_code == 200, res.text
        assert res.json()["deleted"] == 2

        left = [e["id"] for e in client.get("/api/admin/employees", headers=h).json()]
        assert a not in left and b not in left and c in left

        logs = client.get("/api/admin/logs", headers=h).json()
        bulk = [l for l in logs if l["action"] == "bulk_delete"]
        assert len(bulk) == 1
        assert bulk[0]["details"]["count"] == 2
        assert len(bulk[0]["details"]["names"]) == 2


def test_bulk_delete_rejects_an_empty_selection():
    with client:
        h = _admin_headers()
        assert client.post("/api/admin/employees/bulk-delete", headers=h, json={"ids": []}).status_code == 400


def test_bulk_delete_is_admin_only():
    with client:
        db = SessionLocal()
        try:
            if not db.query(User).filter(User.username == "staff2").first():
                db.add(User(username="staff2", password_hash=hash_password("staff-pass"), is_admin=False))
                db.commit()
        finally:
            db.close()
        token = client.post(
            "/api/auth/login", json={"username": "staff2", "password": "staff-pass"}
        ).json()["access_token"]
        res = client.post(
            "/api/admin/employees/bulk-delete",
            headers={"Authorization": f"Bearer {token}"},
            json={"ids": [1]},
        )
        assert res.status_code == 403
