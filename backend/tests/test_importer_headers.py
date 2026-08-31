"""سرستون در سطر دلخواه، و جداکننده‌ای غیر از کاما.

اجرا:  backend/.venv/bin/python -m pytest tests -q
"""
from app.importer import parse_csv


def test_header_not_first_row():
    raw = "لیست داخلی‌ها,,\n\nنام,شماره داخلی,واحد\nعلی,115,اورژانس\n"
    assert parse_csv(raw.encode()) == [
        {"first_name": "علی", "extension": "115", "department": "اورژانس"}
    ]


def test_non_comma_delimiter():
    raw = "نام\x1bشماره داخلی\nعلی\x1b115\n"
    assert parse_csv(raw.encode()) == [{"first_name": "علی", "extension": "115"}]


def test_plain_comma_still_works():
    raw = "نام,شماره داخلی\nعلی,115\n"
    assert parse_csv(raw.encode()) == [{"first_name": "علی", "extension": "115"}]


def test_pbx_export_maps_only_safe_columns():
    raw = "Display Name\x1bUser Extension\x1bSecret\nMr Paydari\x1b111\x1b!User1440\n"
    assert parse_csv(raw.encode()) == [
        {"latin_name": "Mr Paydari", "extension": "111"}
    ]


def test_side_by_side_tables_and_sections():
    raw = (
        "لیست داخلی‌ها,,,\n"
        "واحد,داخلی,واحد,داخلی\n"
        "مدیران,,حراست,\n"
        "مدیر عامل,160,دفتر حراست,159-164\n"
    )
    assert parse_csv(raw.encode()) == [
        {"department": "مدیران", "job_title": "مدیر عامل", "extension": "160"},
        {"department": "حراست", "job_title": "دفتر حراست", "extension": "159"},
        {"department": "حراست", "job_title": "دفتر حراست", "extension": "164"},
    ]


def test_dash_in_real_number_is_not_split():
    raw = "نام,شماره مستقیم,شماره داخلی\nعلی,021-4421-8000,115\n"
    assert parse_csv(raw.encode()) == [
        {"first_name": "علی", "direct_number": "021-4421-8000", "extension": "115"}
    ]


def test_colleague_name_header():
    raw = "ردیف,شماره داخلی,نام واحد,نام همکار\n1,116,HSE,آقای محمودی\n"
    assert parse_csv(raw.encode()) == [
        {"extension": "116", "department": "HSE", "first_name": "آقای محمودی"}
    ]
