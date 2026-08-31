"""ایمپورت: نام، نام خانوادگی، واحد، سمت و داخلی اجباری‌اند.

اجرا:  backend/.venv/bin/python -m pytest tests -q
"""
import os
import tempfile

os.environ["DATABASE_URL"] = f"sqlite:///{tempfile.mkdtemp()}/test.db"
os.environ["ADMIN_USERNAME"] = "root"
os.environ["ADMIN_PASSWORD"] = "root-pass"

from fastapi.testclient import TestClient  # noqa: E402

from app.main import app  # noqa: E402

client = TestClient(app)

HEADER = "نام,نام خانوادگی,واحد,سمت,داخلی\n"


def _admin_headers() -> dict:
    res = client.post("/api/auth/login", json={"username": "root", "password": "root-pass"})
    assert res.status_code == 200, res.text
    return {"Authorization": f"Bearer {res.json()['access_token']}"}


def _upload(headers: dict, csv_text: str) -> dict:
    res = client.post(
        "/api/admin/import",
        headers=headers,
        files={"file": ("people.csv", csv_text.encode("utf-8"), "text/csv")},
    )
    assert res.status_code == 200, res.text
    return res.json()


def test_row_missing_a_required_column_is_rejected():
    with client:
        h = _admin_headers()
        res = _upload(h, HEADER + "سارا,رضایی,فناوری,کارشناس,2001\nرضا,کریمی,فناوری,,2002\n")
        assert res["created"] == 1
        assert res["skipped"] == 1
        assert len(res["errors"]) == 1
        assert "سطر 3" in res["errors"][0] and "سمت" in res["errors"][0]


def test_every_required_column_is_enforced():
    with client:
        h = _admin_headers()
        rows = [
            ",کریمی,فناوری,کارشناس,3001",
            "رضا,,فناوری,کارشناس,3002",
            "رضا,کریمی,,کارشناس,3003",
            "رضا,کریمی,فناوری,,3004",
            "رضا,کریمی,فناوری,کارشناس,",
        ]
        res = _upload(h, HEADER + "\n".join(rows) + "\n")
        assert res["created"] == 0
        assert res["skipped"] == 5
        assert len(res["errors"]) == 5
