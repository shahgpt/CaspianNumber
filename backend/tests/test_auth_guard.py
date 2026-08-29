"""گاردِ دسترسی — سه ادعایی که نباید هیچ‌وقت بشکند.

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


def _login(username: str, password: str) -> str:
    res = client.post("/api/auth/login", json={"username": username, "password": password})
    assert res.status_code == 200, res.text
    return res.json()["access_token"]


def _auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def _make_staff(username: str = "staff", password: str = "staff-pass") -> None:
    db = SessionLocal()
    try:
        if not db.query(User).filter(User.username == username).first():
            db.add(User(username=username, password_hash=hash_password(password), is_admin=False))
            db.commit()
    finally:
        db.close()


def test_directory_needs_a_token():
    with client:  # startup: init_db + ensure_admin
        assert client.get("/api/employees").status_code == 401
        assert client.get("/api/employees/1/vcard").status_code == 401


def test_staff_reads_directory_but_not_the_panel():
    with client:
        _make_staff()
        token = _login("staff", "staff-pass")
        assert client.get("/api/employees", headers=_auth(token)).status_code == 200
        assert client.get("/api/admin/users", headers=_auth(token)).status_code == 403


def test_admin_reaches_the_panel():
    with client:
        token = _login("root", "root-pass")
        res = client.get("/api/admin/users", headers=_auth(token))
        assert res.status_code == 200
        assert client.get("/api/auth/me", headers=_auth(token)).json()["is_admin"] is True


def test_last_admin_cannot_be_stripped():
    with client:
        token = _login("root", "root-pass")
        me = client.get("/api/auth/me", headers=_auth(token)).json()
        # خودش: همیشه رد
        res = client.post(f"/api/admin/users/{me['id']}/toggle-admin", headers=_auth(token))
        assert res.status_code == 400
