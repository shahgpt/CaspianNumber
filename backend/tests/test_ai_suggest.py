"""پیشنهادِ فیلدهای توصیفی — گاردِ ادمین، پارسِ پاسخ، و نبودِ کلید.

اجرا:  backend/.venv/bin/python -m pytest tests -q
"""
import os
import tempfile

os.environ["DATABASE_URL"] = f"sqlite:///{tempfile.mkdtemp()}/test.db"
os.environ["ADMIN_USERNAME"] = "root"
os.environ["ADMIN_PASSWORD"] = "root-pass"

import httpx  # noqa: E402
import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app import ai  # noqa: E402
from app.core.config import settings  # noqa: E402
from app.main import app  # noqa: E402
from app.models import SessionLocal, User  # noqa: E402
from app.security import hash_password  # noqa: E402

client = TestClient(app)
PROFILE = {"first_name": "سارا", "last_name": "رضایی", "job_title": "کارشناس شبکه"}


def _login(username: str, password: str) -> str:
    res = client.post("/api/auth/login", json={"username": username, "password": password})
    assert res.status_code == 200, res.text
    return res.json()["access_token"]


def _auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def _fake_reply(content: str):
    def post(*_args, **_kwargs):
        return httpx.Response(
            200,
            json={"choices": [{"message": {"content": content}}]},
            request=httpx.Request("POST", "http://test"),
        )

    return post


@pytest.fixture
def with_key(monkeypatch):
    monkeypatch.setattr(settings, "AI_API_KEY", "test-key")


def test_needs_a_key(monkeypatch):
    monkeypatch.setattr(settings, "AI_API_KEY", "")
    with pytest.raises(Exception) as err:
        ai.suggest_fields(PROFILE)
    assert err.value.status_code == 503


def test_needs_something_to_go_on(with_key):
    with pytest.raises(Exception) as err:
        ai.suggest_fields({"phone": "021", "email": "a@b.c"})
    assert err.value.status_code == 400


def test_parses_a_fenced_json_reply(with_key, monkeypatch):
    monkeypatch.setattr(
        httpx,
        "post",
        _fake_reply('```json\n{"keywords": "شبکه؛ سارا", "skills": "سیسکو",'
                    ' "languages": "فارسی", "notes": "برای مشکل شبکه"}\n```'),
    )
    out = ai.suggest_fields(PROFILE)
    assert out == {
        "keywords": "شبکه؛ سارا",
        "skills": "سیسکو",
        "languages": "فارسی",
        "notes": "برای مشکل شبکه",
    }


def test_missing_keys_come_back_empty(with_key, monkeypatch):
    monkeypatch.setattr(httpx, "post", _fake_reply('{"keywords": "شبکه"}'))
    assert ai.suggest_fields(PROFILE) == {
        "keywords": "شبکه", "skills": "", "languages": "", "notes": ""
    }


def test_garbage_reply_is_a_502(with_key, monkeypatch):
    monkeypatch.setattr(httpx, "post", _fake_reply("نمی‌دانم"))
    with pytest.raises(Exception) as err:
        ai.suggest_fields(PROFILE)
    assert err.value.status_code == 502


def test_unreachable_service_says_so(with_key, monkeypatch):
    def boom(*_a, **_kw):
        raise httpx.ConnectError("blocked", request=httpx.Request("POST", "http://test"))

    monkeypatch.setattr(httpx, "post", boom)
    with pytest.raises(Exception) as err:
        ai.suggest_fields(PROFILE)
    assert err.value.status_code == 502
    assert "AI_BASE_URL" in err.value.detail


def test_upstream_status_error_is_reported(with_key, monkeypatch):
    def unauthorized(*_a, **_kw):
        return httpx.Response(401, json={}, request=httpx.Request("POST", "http://test"))

    monkeypatch.setattr(httpx, "post", unauthorized)
    with pytest.raises(Exception) as err:
        ai.suggest_fields(PROFILE)
    assert err.value.status_code == 502
    assert "401" in err.value.detail


def test_upstream_reason_reaches_the_admin(with_key, monkeypatch):
    """مدلِ ناموجود: پیامِ خودِ سرویس باید دیده شود، نه فقط کد ۴۰۰."""

    def bad_model(*_a, **_kw):
        return httpx.Response(
            400,
            json={"error": {"message": "The model `gpt-x` does not exist"}},
            request=httpx.Request("POST", "http://test"),
        )

    monkeypatch.setattr(httpx, "post", bad_model)
    with pytest.raises(Exception) as err:
        ai.suggest_fields(PROFILE)
    assert "does not exist" in err.value.detail


def test_no_sampling_params_are_sent(with_key, monkeypatch):
    """مدل‌های تازه با temperature‌ی سفارشی ۴۰۰ می‌دهند — پس فرستاده نمی‌شود."""
    sent = {}

    def capture(*_a, **kwargs):
        sent.update(kwargs["json"])
        return httpx.Response(
            200,
            json={"choices": [{"message": {"content": '{"keywords": "x"}'}}]},
            request=httpx.Request("POST", "http://test"),
        )

    monkeypatch.setattr(httpx, "post", capture)
    ai.suggest_fields(PROFILE)
    assert set(sent) == {"model", "messages"}


def test_endpoint_is_admin_only(with_key, monkeypatch):
    monkeypatch.setattr(httpx, "post", _fake_reply('{"keywords": "شبکه"}'))
    with client:
        db = SessionLocal()
        try:
            if not db.query(User).filter(User.username == "staff").first():
                db.add(User(username="staff", password_hash=hash_password("staff-pass"),
                            is_admin=False))
                db.commit()
        finally:
            db.close()

        staff = _login("staff", "staff-pass")
        assert client.post("/api/admin/employees/suggest", json=PROFILE,
                           headers=_auth(staff)).status_code == 403

        admin = _login("root", "root-pass")
        res = client.post("/api/admin/employees/suggest", json=PROFILE, headers=_auth(admin))
        assert res.status_code == 200, res.text
        assert res.json()["keywords"] == "شبکه"
