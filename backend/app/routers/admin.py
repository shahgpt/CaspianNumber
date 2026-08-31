"""Admin API: employee CRUD, users, Excel/CSV import, change log."""
import json
from datetime import timezone

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from sqlalchemy.orm import Session

from ..database import get_db
from ..ai import suggest_fields
from ..importer import apply_import, parse_csv, parse_xlsx
from ..models import ChangeLog, Employee, User, gen_temp_password, is_temp_password
from ..schemas import (BulkDeleteIn, EmployeeCreate, EmployeeOut, EmployeeUpdate,
                       ImportResult, SuggestOut, TempPasswordOut, UserCreate,
                       UserCreatedOut, UserCredentialsIn, UserOut)
from ..security import get_current_user, hash_password, require_admin

router = APIRouter(prefix="/api/admin", tags=["admin"], dependencies=[Depends(require_admin)])


def log(db: Session, actor, entity: str, entity_id, action: str, details=None):
    db.add(
        ChangeLog(
            entity=entity,
            entity_id=entity_id,
            action=action,
            actor_id=getattr(actor, "id", None),
            actor_name=getattr(actor, "username", "?"),
            details=details,
        )
    )
    db.commit()


# ---------------- Employees ----------------

@router.get("/employees")
def list_all(user=Depends(require_admin), db: Session = Depends(get_db)):
    emps = db.query(Employee).order_by(Employee.department, Employee.last_name).all()
    return [EmployeeOut.model_validate(e).model_dump() for e in emps]


@router.post("/employees", response_model=EmployeeOut)
def create_employee(data: EmployeeCreate, user=Depends(require_admin), db: Session = Depends(get_db)):
    emp = Employee(**data.model_dump())
    emp.sync_direct_number()
    emp.rebuild_search_text()
    db.add(emp)
    db.commit()
    db.refresh(emp)
    from .. import fts
    fts.upsert_employee(db, emp.id, emp.search_text)
    log(db, user, "employee", emp.id, "create", {"name": emp.full_name})
    return emp


@router.post("/employees/suggest", response_model=SuggestOut)
def suggest_employee_fields(data: EmployeeCreate, user=Depends(require_admin)):
    """فیلدهای توصیفی را از روی بقیه‌ی فرم پیشنهاد می‌دهد — چیزی ذخیره نمی‌شود."""
    return suggest_fields(data.model_dump())


@router.patch("/employees/{emp_id}", response_model=EmployeeOut)
def update_employee(
    emp_id: int, data: EmployeeUpdate, user=Depends(require_admin), db: Session = Depends(get_db)
):
    emp = db.get(Employee, emp_id)
    if not emp:
        raise HTTPException(404, "یافت نشد")
    changed = {}
    for field, val in data.model_dump().items():
        old = getattr(emp, field)
        if val != old:
            setattr(emp, field, val)
            changed[field] = {"from": old, "to": val}
    # داخلی که عوض شد و ادمین مستقیم را دستی ننوشت، دوباره ساخته می‌شود
    if "extension" in changed and not data.direct_number.strip():
        emp.direct_number = ""
    emp.sync_direct_number()
    emp.rebuild_search_text()
    db.commit()
    db.refresh(emp)
    if changed:
        from .. import fts
        fts.upsert_employee(db, emp.id, emp.search_text)
        log(db, user, "employee", emp.id, "update", changed)
    return emp


BULK_DELETE_MAX = 500


@router.post("/employees/bulk-delete")
def bulk_delete_employees(
    data: BulkDeleteIn, user=Depends(require_admin), db: Session = Depends(get_db)
):
    """حذفِ چند نفر با هم — یک تراکنش و یک سطرِ لاگ، نه یکی به ازای هر نفر."""
    ids = list(dict.fromkeys(data.ids))
    if not ids:
        raise HTTPException(400, "کسی برای حذف انتخاب نشده است")
    if len(ids) > BULK_DELETE_MAX:
        raise HTTPException(400, f"در هر نوبت حداکثر {BULK_DELETE_MAX} نفر حذف می‌شود")

    emps = db.query(Employee).filter(Employee.id.in_(ids)).all()
    if not emps:
        raise HTTPException(404, "یافت نشد")

    from .. import fts
    found = [(e.id, e.full_name) for e in emps]
    for emp in emps:
        db.delete(emp)
    for emp_id, _ in found:
        fts.delete_employee(db, emp_id)
    names = [name for _, name in found]
    # log خودش commit می‌کند؛ حذف‌ها و پاک‌سازیِ ایندکس با همان یک تراکنش می‌نشیند.
    log(db, user, "employee", None, "bulk_delete", {"count": len(emps), "names": names[:20]})
    return {"deleted": len(emps)}


@router.delete("/employees/{emp_id}")
def delete_employee(emp_id: int, user=Depends(require_admin), db: Session = Depends(get_db)):
    emp = db.get(Employee, emp_id)
    if not emp:
        raise HTTPException(404, "یافت نشد")
    name = emp.full_name
    db.delete(emp)
    log(db, user, "employee", emp_id, "delete", {"name": name})
    db.commit()
    from .. import fts
    fts.delete_employee(db, emp_id)
    return {"ok": True}


# ---------------- Users ----------------

@router.get("/users")
def list_users(user=Depends(require_admin), db: Session = Depends(get_db)):
    """فهرست حساب‌های ادمین — بدون رمز.

    رمز هیچ‌جا خوانا نگه داشته نمی‌شود؛ اگر کسی رمزش را گم کرد، ادمینِ
    دیگری «رمز موقت» می‌سازد و همان یک‌بار می‌بیندش.
    """
    users = db.query(User).order_by(User.username).all()
    return [UserOut.model_validate(u).model_dump() for u in users]


@router.post("/users", response_model=UserCreatedOut)
def create_user(data: UserCreate, user=Depends(require_admin), db: Session = Depends(get_db)):
    """حسابِ تازه با رمزِ موقت — رمز فقط در همین پاسخ برمی‌گردد."""
    username = data.username.strip().lower()
    if not username:
        raise HTTPException(400, "نام کاربری خالی است")
    if db.query(User).filter(User.username == username).first():
        raise HTTPException(400, "این نام کاربری قبلاً ثبت شده است")
    temp_password = gen_temp_password()
    u = User(
        username=username,
        password_hash=hash_password(temp_password),
        is_admin=data.is_admin,
    )
    db.add(u)
    db.commit()
    db.refresh(u)
    log(db, user, "user", u.id, "create", {"username": username, "is_admin": u.is_admin})
    return {"id": u.id, "username": u.username, "is_active": u.is_active,
            "is_admin": u.is_admin, "temp_password": temp_password}


@router.post("/users/{user_id}/toggle-admin")
def toggle_admin(user_id: int, user=Depends(require_admin), db: Session = Depends(get_db)):
    """کاربرِ عادی را ادمین می‌کند و برعکس.

    دو در بسته است: ادمین نمی‌تواند نقشِ خودش را بردارد (که خودش را از
    پنل بیرون بیندازد)، و آخرین ادمین هم نمی‌تواند برداشته شود — وگرنه
    پنل برای همیشه قفل می‌شود.
    """
    target = db.get(User, user_id)
    if not target:
        raise HTTPException(404, "کاربر یافت نشد")
    if target.id == user.id:
        raise HTTPException(400, "نمی‌توانید نقش خودتان را عوض کنید")
    if target.is_admin and _admin_count(db) <= 1:
        raise HTTPException(400, "آخرین ادمین را نمی‌توان برداشت")
    target.is_admin = not target.is_admin
    log(db, user, "user", user_id, "toggle_admin", {"is_admin": target.is_admin})
    db.commit()
    return {"ok": True, "is_admin": target.is_admin}


def _admin_count(db: Session) -> int:
    return db.query(User).filter(User.is_admin.is_(True), User.is_active.is_(True)).count()


@router.patch("/users/{user_id}/credentials")
def set_credentials(
    user_id: int,
    data: UserCredentialsIn,
    user=Depends(require_admin),
    db: Session = Depends(get_db),
):
    """نام کاربری و رمز را دستی ست می‌کند — هرکدام که فرستاده شود."""
    target = db.get(User, user_id)
    if not target:
        raise HTTPException(404, "کاربر یافت نشد")

    changed = {}
    username = data.username.strip().lower()
    if username and username != target.username:
        clash = db.query(User).filter(User.username == username, User.id != user_id).first()
        if clash:
            raise HTTPException(400, "این نام کاربری قبلاً ثبت شده است")
        changed["username"] = {"from": target.username, "to": username}
        target.username = username

    password = data.password.strip()
    if password:
        if len(password) < 6:
            raise HTTPException(400, "رمز باید دست‌کم ۶ نویسه باشد")
        if is_temp_password(password):
            raise HTTPException(400, "رمز نمی‌تواند با «tmp-» شروع شود")
        target.password_hash = hash_password(password)
        changed["password"] = True

    if not changed:
        raise HTTPException(400, "چیزی برای تغییر فرستاده نشد")

    log(db, user, "user", user_id, "set_credentials",
        {"username": target.username, "fields": list(changed)})
    db.commit()
    # رمز برنمی‌گردد: ادمین همین الان خودش نوشته‌اش، و سیستم دیگر نگهش نمی‌دارد.
    return {"ok": True, "username": target.username}


@router.post("/users/{user_id}/reset-password", response_model=TempPasswordOut)
def reset_password(user_id: int, user=Depends(require_admin), db: Session = Depends(get_db)):
    """رمزِ موقتِ یک‌بارمصرف می‌سازد.

    فقط هشش ذخیره می‌شود؛ متنِ رمز همین‌جا برمی‌گردد و بس. چون با «tmp-»
    شروع می‌شود، ورودِ بعدی کاربر را پای تغییر رمز می‌نشاند.
    """
    target = db.get(User, user_id)
    if not target:
        raise HTTPException(404, "کاربر یافت نشد")
    temp_password = gen_temp_password()
    target.password_hash = hash_password(temp_password)
    log(db, user, "user", user_id, "reset_password", {"username": target.username})
    db.commit()
    return {"username": target.username, "temp_password": temp_password}


@router.post("/users/{user_id}/toggle-active")
def toggle_active(user_id: int, user=Depends(require_admin), db: Session = Depends(get_db)):
    target = db.get(User, user_id)
    if not target:
        raise HTTPException(404, "کاربر یافت نشد")
    if target.id == user.id:
        raise HTTPException(400, "نمی‌توانید حساب خودتان را غیرفعال کنید")
    if target.is_active and target.is_admin and _admin_count(db) <= 1:
        raise HTTPException(400, "آخرین ادمین را نمی‌توان غیرفعال کرد")
    target.is_active = not target.is_active
    log(db, user, "user", user_id, "toggle_active", {"active": target.is_active})
    db.commit()
    return {"ok": True, "is_active": target.is_active}


# ---------------- Import ----------------

@router.post("/import", response_model=ImportResult)
async def import_file(
    file: UploadFile = File(...),
    user=Depends(require_admin),
    db: Session = Depends(get_db),
):
    content = await file.read()
    name = (file.filename or "").lower()
    try:
        if name.endswith(".xlsx") or name.endswith(".xls"):
            records = parse_xlsx(content)
        elif name.endswith(".csv"):
            records = parse_csv(content)
        else:
            raise HTTPException(400, "فقط فایل xlsx یا csv پذیرفته می‌شود")
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(400, f"خواندن فایل ناموفق بود: {exc}")

    result = apply_import(db, records, actor=user)
    log(db, user, "import", None, "import", {"file": file.filename, **result})
    return result


# ---------------- Change log ----------------

@router.get("/logs")
def list_logs(limit: int = 100, user=Depends(require_admin), db: Session = Depends(get_db)):
    rows = db.query(ChangeLog).order_by(ChangeLog.id.desc()).limit(min(limit, 500)).all()
    return [
        {
            "id": r.id,
            "entity": r.entity,
            "entity_id": r.entity_id,
            "action": r.action,
            "actor_name": r.actor_name,
            "details": r.details,
            # SQLite زمان را بدون منطقه ذخیره می‌کند و UTC است؛ بدون این برچسب
            # مرورگر آن را «محلی» می‌خواند و ساعت‌ها جابه‌جا نشان می‌دهد.
            "at": r.at.replace(tzinfo=r.at.tzinfo or timezone.utc).isoformat() if r.at else None,
        }
        for r in rows
    ]
