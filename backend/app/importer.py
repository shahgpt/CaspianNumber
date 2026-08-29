"""Excel/CSV import: Persian header mapping, upsert, account creation."""
import csv
import io

from openpyxl import load_workbook
from sqlalchemy.orm import Session

from .core.persian import light_normalize
from .models import ChangeLog, Employee

# Persian (and common alternate) headers -> model field
HEADER_MAP = {
    "نام": "first_name",
    "firstname": "first_name",
    "نام خانوادگی": "last_name",
    "lastname": "last_name",
    "نام لاتین": "latin_name",
    "لاتین": "latin_name",
    "شماره مستقیم": "direct_number",
    "خط مستقیم": "direct_number",
    "مستقیم": "direct_number",
    "شماره داخلی (اداری)": "extension",
    "داخلی": "extension",
    "شماره داخلی": "extension",
    "شماره ثابت": "phone",
    "تلفن ثابت": "phone",
    "ایمیل سازمانی": "email",
    "ایمیل": "email",
    "واحد / دپارتمان": "department",
    "واحد": "department",
    "دپارتمان": "department",
    "شرکت": "company",
    "سمت": "job_title",
    "محل خدمت": "location",
    "آدرس": "location",
    "عکس (مسیر/لینک)": "photo_url",
    "عکس": "photo_url",
    "کلمات کلیدی و نام\u200cهای مستعار": "keywords",
    "کلیدواژه": "keywords",
    "کلمات کلیدی": "keywords",
    "مهارت\u200cها / حوزه کاری": "skills",
    "مهارت‌ها": "skills",
    "زبان\u200cها": "languages",
    "زبان": "languages",
    "ساعت کاری / بهترین زمان تماس": "working_hours",
    "ساعت کاری": "working_hours",
    "یادداشت": "notes",
}

# columns that identify a row for upsert purposes
KEY_FIELDS = ("email", "extension", "direct_number", "latin_name")


def _cell_str(v) -> str:
    if v is None:
        return ""
    return light_normalize(str(v)).strip()


def _norm_header(h) -> str:
    if h is None:
        return ""
    return light_normalize(str(h)).replace("\u200c", "").replace(" ", "").lower()


_NORMED_MAP = None


def _normed_map() -> dict[str, str]:
    global _NORMED_MAP
    if _NORMED_MAP is None:
        _NORMED_MAP = {(_norm_header(raw) or "\x00"): field for raw, field in HEADER_MAP.items()}
    return _NORMED_MAP


def _match_field(nh: str) -> str | None:
    """Exact match first; then longest-header containment (guarded).

    Containment requires the mapped header to be >=4 normalized chars so
    short headers like 'نام' can't hijack longer ones like
    'کلمات کلیدی و نام‌های مستعار'.
    """
    m = _normed_map()
    if nh in m:
        return m[nh]
    best_raw, best_field = None, None
    for nraw, field in m.items():
        if nraw == "\x00":
            continue
        if len(nraw) >= 4 and nraw in nh:
            if best_raw is None or len(nraw) > len(best_raw):
                best_raw, best_field = nraw, field
    return best_field


def _build_header_map(headers) -> dict[int, str]:
    """Map column index -> field name using normalized header matching."""
    out = {}
    seen_fields = set()
    for i, h in enumerate(headers):
        nh = _norm_header(h)
        if not nh:
            continue
        field = _match_field(nh)
        if field and field not in seen_fields:
            out[i] = field
            seen_fields.add(field)
    return out


def parse_xlsx(content: bytes) -> list[dict]:
    wb = load_workbook(io.BytesIO(content), read_only=True, data_only=True)
    ws = wb.active
    rows = list(ws.iter_rows(values_only=True))
    return _parse_rows(rows)


def parse_csv(content: bytes) -> list[dict]:
    text = content.decode("utf-8-sig", errors="replace")
    reader = csv.reader(io.StringIO(text))
    return _parse_rows(list(reader))


def _parse_rows(rows) -> list[dict]:
    if not rows:
        return []
    colmap = _build_header_map(rows[0])
    records = []
    for row in rows[1:]:
        rec = {}
        for idx, field in colmap.items():
            if idx < len(row):
                rec[field] = _cell_str(row[idx])
        # skip fully empty rows
        if any(v for v in rec.values()):
            records.append(rec)
    return records


def _find_existing(db: Session, rec: dict) -> Employee | None:
    for f in KEY_FIELDS:
        val = (rec.get(f) or "").strip()
        if not val:
            continue
        col = getattr(Employee, f)
        emp = db.query(Employee).filter(col == val).first()
        if emp:
            return emp
    fn, ln = rec.get("first_name", ""), rec.get("last_name", "")
    if fn and ln:
        emp = (
            db.query(Employee)
            .filter(Employee.first_name == fn, Employee.last_name == ln)
            .first()
        )
        if emp:
            return emp
    return None


def apply_import(db: Session, records: list[dict], actor) -> dict:
    """ایمپورت فقط دفترچه را پر می‌کند — حسابِ ورود نمی‌سازد.

    دفترچه ورود نمی‌خواهد، پس پرسنل حساب لازم ندارند؛ حساب فقط برای
    ادمین است و دستی ساخته می‌شود.
    """
    created_n = updated_n = skipped_n = 0
    errors: list[str] = []

    for i, rec in enumerate(records, start=2):  # excel row numbers (header=row1)
        try:
            name = " ".join(x for x in [rec.get("first_name", ""), rec.get("last_name", "")] if x)
            if not any(rec.get(f, "") for f in ("direct_number", "email", "extension")) and not name.strip():
                skipped_n += 1
                continue

            emp = _find_existing(db, rec)
            if emp is None:
                emp = Employee()
                db.add(emp)
                created_n += 1
                action = "create"
            else:
                updated_n += 1
                action = "update"

            for field in set(HEADER_MAP.values()):
                val = rec.get(field)
                if val is not None and val != "":
                    setattr(emp, field, val)
            emp.sync_direct_number()
            emp.rebuild_search_text()
            # flush now so a freshly-created employee gets its id
            # (the change log below needs it)
            db.flush()
            db.add(
                ChangeLog(
                    entity="employee",
                    entity_id=emp.id,
                    action="import" if action == "create" else "import_update",
                    actor_id=getattr(actor, "id", None),
                    actor_name=getattr(actor, "username", "system"),
                    details={"row": i, "name": light_normalize(name)},
                )
            )
        except Exception as exc:  # keep importing other rows
            errors.append(f"سطر {i}: {exc}")

    db.commit()
    try:
        from . import fts as _fts
        _fts.reindex_all(db)
    except Exception:
        pass  # FTS اختیاری است؛ init_db در restart هم rebuild می‌کند
    return {
        "created": created_n,
        "updated": updated_n,
        "skipped": skipped_n,
        "errors": errors,
    }
