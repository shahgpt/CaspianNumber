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


def test_temporary_password_blocks_app_until_it_is_changed():
    with client:
        admin_token = _login("root", "root-pass")
        created = client.post(
            "/api/admin/users",
            headers=_auth(admin_token),
            json={"username": "first-login-admin", "is_admin": True},
        )
        assert created.status_code == 200, created.text
        assert created.json()["must_change_password"] is True
        temp_password = created.json()["temp_password"]

        login = client.post(
            "/api/auth/login",
            json={"username": "first-login-admin", "password": temp_password},
        )
        assert login.status_code == 200, login.text
        assert login.json()["must_change_password"] is True
        token = login.json()["access_token"]

        me = client.get("/api/auth/me", headers=_auth(token))
        assert me.status_code == 200
        assert me.json()["must_change_password"] is True

        directory = client.get("/api/employees", headers=_auth(token))
        assert directory.status_code == 403
        assert "رمز عبور موقت" in directory.json()["detail"]
        assert client.get("/api/admin/users", headers=_auth(token)).status_code == 403

        changed = client.post(
            "/api/auth/change-password",
            headers=_auth(token),
            json={"current_password": temp_password, "new_password": "my-new-password"},
        )
        assert changed.status_code == 200, changed.text
        assert client.get("/api/auth/me", headers=_auth(token)).json()[
            "must_change_password"
        ] is False
        assert client.get("/api/employees", headers=_auth(token)).status_code == 200
        assert client.get("/api/admin/users", headers=_auth(token)).status_code == 200

        assert client.post(
            "/api/auth/login",
            json={"username": "first-login-admin", "password": temp_password},
        ).status_code == 401
        relogin = client.post(
            "/api/auth/login",
            json={"username": "first-login-admin", "password": "my-new-password"},
        )
        assert relogin.status_code == 200
        assert relogin.json()["must_change_password"] is False


def test_password_reset_relocks_an_existing_session():
    with client:
        _make_staff("reset-user", "old-password")
        staff_token = _login("reset-user", "old-password")
        assert client.get("/api/employees", headers=_auth(staff_token)).status_code == 200

        admin_token = _login("root", "root-pass")
        users = client.get("/api/admin/users", headers=_auth(admin_token)).json()
        user_id = next(u["id"] for u in users if u["username"] == "reset-user")
        reset = client.post(
            f"/api/admin/users/{user_id}/reset-password",
            headers=_auth(admin_token),
        )
        assert reset.status_code == 200, reset.text

        # حتی توکنِ قدیمی هم دیگر نباید با دورزدن UI دفترچه را ببیند.
        assert client.get("/api/employees", headers=_auth(staff_token)).status_code == 403
        temp_login = client.post(
            "/api/auth/login",
            json={"username": "reset-user", "password": reset.json()["temp_password"]},
        )
        assert temp_login.status_code == 200
        assert temp_login.json()["must_change_password"] is True
