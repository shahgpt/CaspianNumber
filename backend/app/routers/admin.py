"""Tenant-safe administration API."""
from __future__ import annotations

from datetime import timezone

from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile
from sqlalchemy import or_
from sqlalchemy.orm import Session

from .. import fts
from ..ai import suggest_fields
from ..audit import audit_event
from ..database import get_db
from ..importer import apply_import, parse_csv, parse_xlsx
from ..models import (
    ORG_HEAD_OFFICE, ROLE_GLOBAL_ADMIN, ROLE_HEAD_OFFICE_ACCESS_ADMIN,
    ROLE_UNIT_MANAGER, ROLE_UNIT_USER, VALID_ORGANIZATION_TYPES, VALID_ROLES,
    ChangeLog, Employee, Organization, User, gen_temp_password, is_temp_password,
)
from ..schemas import (
    BulkDeleteIn, EmployeeCreate, EmployeeOut, EmployeeUpdate, ImportResult,
    OrganizationCreate, OrganizationOut, OrganizationUpdate, SuggestOut,
    TempPasswordOut, UserCreate, UserCreatedOut, UserCredentialsIn, UserOut,
    UserRoleUpdate,
)
from ..security import (
    can_manage_global_admins, hash_password, password_is_strong, require_admin,
    require_global_admin, resolve_scope_organization,
)

router = APIRouter(prefix="/api/admin", tags=["admin"], dependencies=[Depends(require_admin)])
BULK_DELETE_MAX = 500


def _scope(user: User, organization_id: int | None, db: Session, *, all_for_global: bool = True) -> int | None:
    return resolve_scope_organization(user, organization_id, db, allow_all_for_global=all_for_global)


def _employee_or_404(db: Session, employee_id: int, user: User, organization_id: int | None) -> Employee:
    scope = _scope(user, organization_id, db)
    query = db.query(Employee).filter(Employee.id == employee_id)
    if scope is not None:
        query = query.filter(Employee.organization_id == scope)
    employee = query.first()
    if not employee:
        raise HTTPException(404, "یافت نشد")
    return employee


def _user_or_404(db: Session, user_id: int, actor: User, organization_id: int | None = None) -> User:
    scope = _scope(actor, organization_id, db)
    query = db.query(User).filter(User.id == user_id)
    if scope is not None:
        query = query.filter(User.organization_id == scope)
    target = query.first()
    if not target:
        raise HTTPException(404, "کاربر یافت نشد")
    return target


def _user_payload(user: User) -> dict:
    return {
        "id": user.id, "username": user.username,
        "organization_id": user.organization_id,
        "organization_name": user.organization.name if user.organization else "",
        "role": user.role, "is_active": user.is_active, "is_admin": user.is_admin,
        "must_change_password": user.must_change_password,
        "manage_global_admins": user.manage_global_admins,
        "can_delete_data": user.can_delete_data, "mfa_enabled": user.mfa_enabled,
    }


def _validate_role_change(
    db: Session, actor: User, target_org: Organization, role: str,
    manage_global_admins: bool,
) -> None:
    if role not in VALID_ROLES:
        raise HTTPException(400, "نقش معتبر نیست")
    elevated = role in {ROLE_GLOBAL_ADMIN, ROLE_HEAD_OFFICE_ACCESS_ADMIN} or manage_global_admins
    if elevated:
        if target_org.kind != ORG_HEAD_OFFICE or not can_manage_global_admins(actor, db):
            raise HTTPException(403, "مدیریت این نقش فقط با مجوز دفتر مرکزی ممکن است")
    if manage_global_admins and role not in {ROLE_HEAD_OFFICE_ACCESS_ADMIN, ROLE_GLOBAL_ADMIN}:
        raise HTTPException(400, "مجوز manage_global_admins فقط برای نقش‌های دفتر مرکزی مجاز است")
    if actor.role != ROLE_GLOBAL_ADMIN and target_org.id != actor.organization_id:
        raise HTTPException(404, "واحد سازمانی یافت نشد")


def _require_delete(user: User) -> None:
    if user.role != ROLE_GLOBAL_ADMIN and not user.can_delete_data:
        raise HTTPException(403, "مجوز حذف داده را ندارید")


def _require_privileged_account_management(db: Session, actor: User, target: User) -> None:
    """Prevent takeover or disabling of accounts that can grant global access."""
    privileged = target.role in {ROLE_GLOBAL_ADMIN, ROLE_HEAD_OFFICE_ACCESS_ADMIN} or target.manage_global_admins
    if privileged and not can_manage_global_admins(actor, db):
        raise HTTPException(403, "مدیریت این حساب فقط با مجوز manage_global_admins ممکن است")


# ---------------- Organizations ----------------

@router.get("/organizations", response_model=list[OrganizationOut])
def list_organizations(user: User = Depends(require_admin), db: Session = Depends(get_db)):
    if user.role == ROLE_GLOBAL_ADMIN:
        return db.query(Organization).order_by(Organization.kind, Organization.name).all()
    org = db.get(Organization, user.organization_id)
    return [org] if org else []


@router.post("/organizations", response_model=OrganizationOut)
def create_organization(
    data: OrganizationCreate, request: Request,
    user: User = Depends(require_global_admin), db: Session = Depends(get_db),
):
    if data.kind not in VALID_ORGANIZATION_TYPES:
        raise HTTPException(400, "نوع واحد سازمانی معتبر نیست")
    code = data.code.strip().upper()
    name = data.name.strip()
    if db.query(Organization).filter(or_(Organization.code == code, Organization.name == name)).first():
        raise HTTPException(400, "نام یا کد واحد قبلاً ثبت شده است")
    org = Organization(name=name, code=code, kind=data.kind)
    db.add(org)
    db.flush()
    audit_event(db, action="ORGANIZATION_CREATED", entity="organization", entity_id=org.id,
                organization_id=org.id, actor=user, request=request, details={"name": name, "kind": data.kind})
    db.commit()
    return org


@router.patch("/organizations/{org_id}", response_model=OrganizationOut)
def update_organization(
    org_id: int, data: OrganizationUpdate, request: Request,
    user: User = Depends(require_global_admin), db: Session = Depends(get_db),
):
    org = db.get(Organization, org_id)
    if not org:
        raise HTTPException(404, "واحد سازمانی یافت نشد")
    changes = data.model_dump(exclude_none=True)
    if "code" in changes:
        changes["code"] = changes["code"].strip().upper()
    if "name" in changes:
        changes["name"] = changes["name"].strip()
    if changes.get("is_active") is False and org.kind == ORG_HEAD_OFFICE:
        raise HTTPException(400, "دفتر مرکزی را نمی‌توان غیرفعال کرد")
    duplicate_filters = []
    if "code" in changes:
        duplicate_filters.append(Organization.code == changes["code"])
    if "name" in changes:
        duplicate_filters.append(Organization.name == changes["name"])
    if duplicate_filters and db.query(Organization).filter(
        Organization.id != org.id, or_(*duplicate_filters)
    ).first():
        raise HTTPException(400, "نام یا کد واحد قبلاً ثبت شده است")
    before = {field: getattr(org, field) for field in changes}
    for field, value in changes.items():
        setattr(org, field, value)
    audit_event(db, action="ORGANIZATION_UPDATED", entity="organization", entity_id=org.id,
                organization_id=org.id, actor=user, request=request,
                details={field: {"from": before[field], "to": value} for field, value in changes.items()})
    db.commit()
    return org


# ---------------- Employees ----------------

@router.get("/employees", response_model=list[EmployeeOut])
def list_all(
    request: Request, organization_id: int | None = None,
    user: User = Depends(require_admin), db: Session = Depends(get_db),
):
    scope = _scope(user, organization_id, db)
    query = db.query(Employee)
    if scope is not None:
        query = query.filter(Employee.organization_id == scope)
    rows = query.order_by(Employee.department, Employee.last_name, Employee.id).all()
    audit_event(db, action="SENSITIVE_LIST_VIEW", entity="employee", actor=user,
                organization_id=scope, request=request,
                details={"count": len(rows), "all_units": scope is None})
    db.commit()
    return rows


@router.post("/employees", response_model=EmployeeOut)
def create_employee(
    data: EmployeeCreate, request: Request, organization_id: int | None = None,
    user: User = Depends(require_admin), db: Session = Depends(get_db),
):
    org_id = _scope(user, organization_id, db, all_for_global=False)
    emp = Employee(organization_id=org_id, **data.model_dump())
    emp.sync_direct_number(); emp.rebuild_search_text()
    db.add(emp); db.flush()
    fts.upsert_employee(db, emp.id, emp.organization_id, emp.search_text)
    audit_event(db, action="CREATE", entity="employee", entity_id=emp.id,
                organization_id=emp.organization_id, actor=user, request=request,
                details={"name": emp.full_name})
    db.commit()
    return emp


@router.post("/employees/suggest", response_model=SuggestOut)
def suggest_employee_fields(data: EmployeeCreate, user: User = Depends(require_admin)):
    return suggest_fields(data.model_dump())


@router.patch("/employees/{emp_id}", response_model=EmployeeOut)
def update_employee(
    emp_id: int, data: EmployeeUpdate, request: Request, organization_id: int | None = None,
    user: User = Depends(require_admin), db: Session = Depends(get_db),
):
    emp = _employee_or_404(db, emp_id, user, organization_id)
    changed = {}
    for field, val in data.model_dump().items():
        old = getattr(emp, field)
        if val != old:
            setattr(emp, field, val); changed[field] = {"from": old, "to": val}
    if "extension" in changed and not data.direct_number.strip():
        emp.direct_number = ""
    emp.sync_direct_number(); emp.rebuild_search_text()
    fts.upsert_employee(db, emp.id, emp.organization_id, emp.search_text)
    if changed:
        audit_event(db, action="UPDATE", entity="employee", entity_id=emp.id,
                    organization_id=emp.organization_id, actor=user, request=request, details=changed)
    db.commit()
    return emp


@router.post("/employees/bulk-delete")
def bulk_delete_employees(
    data: BulkDeleteIn, request: Request, organization_id: int | None = None,
    user: User = Depends(require_admin), db: Session = Depends(get_db),
):
    _require_delete(user)
    ids = list(dict.fromkeys(data.ids))
    if not ids:
        raise HTTPException(400, "کسی برای حذف انتخاب نشده است")
    if len(ids) > BULK_DELETE_MAX:
        raise HTTPException(400, f"در هر نوبت حداکثر {BULK_DELETE_MAX} نفر حذف می‌شود")
    scope = _scope(user, organization_id, db)
    query = db.query(Employee).filter(Employee.id.in_(ids))
    if scope is not None:
        query = query.filter(Employee.organization_id == scope)
    emps = query.all()
    # Atomic all-or-nothing prevents smuggling foreign ids beside local ids.
    if len(emps) != len(ids):
        raise HTTPException(404, "یک یا چند رکورد یافت نشد")
    names = [e.full_name for e in emps]
    org_ids = {e.organization_id for e in emps}
    for emp in emps:
        fts.delete_employee(db, emp.id); db.delete(emp)
    audit_event(db, action="bulk_delete", entity="employee", actor=user,
                organization_id=next(iter(org_ids)) if len(org_ids) == 1 else None,
                request=request, details={"count": len(emps), "names": names[:20], "ids": ids})
    db.commit()
    return {"deleted": len(emps)}


@router.delete("/employees/{emp_id}")
def delete_employee(
    emp_id: int, request: Request, organization_id: int | None = None,
    user: User = Depends(require_admin), db: Session = Depends(get_db),
):
    _require_delete(user)
    emp = _employee_or_404(db, emp_id, user, organization_id)
    name, org_id = emp.full_name, emp.organization_id
    fts.delete_employee(db, emp.id); db.delete(emp)
    audit_event(db, action="DELETE", entity="employee", entity_id=emp_id,
                organization_id=org_id, actor=user, request=request, details={"name": name})
    db.commit()
    return {"ok": True}


# ---------------- Users and roles ----------------

@router.get("/users", response_model=list[UserOut])
def list_users(
    request: Request, organization_id: int | None = None,
    user: User = Depends(require_admin), db: Session = Depends(get_db),
):
    scope = _scope(user, organization_id, db)
    query = db.query(User)
    if scope is not None:
        query = query.filter(User.organization_id == scope)
    rows = query.order_by(User.username).all()
    audit_event(db, action="SENSITIVE_LIST_VIEW", entity="user", actor=user,
                organization_id=scope, request=request,
                details={"count": len(rows), "all_units": scope is None})
    db.commit()
    return [_user_payload(row) for row in rows]


@router.post("/users", response_model=UserCreatedOut)
def create_user(
    data: UserCreate, request: Request,
    user: User = Depends(require_admin), db: Session = Depends(get_db),
):
    username = data.username.strip().lower()
    if db.query(User).filter(User.username == username).first():
        raise HTTPException(400, "این نام کاربری قبلاً ثبت شده است")
    requested_org = data.organization_id
    org_id = _scope(user, requested_org, db, all_for_global=False)
    org = db.get(Organization, org_id)
    if not org:
        raise HTTPException(404, "واحد سازمانی یافت نشد")
    role = ROLE_UNIT_MANAGER if data.is_admin is True else data.role
    _validate_role_change(db, user, org, role, data.manage_global_admins)
    temp_password = gen_temp_password()
    target = User(
        username=username, password_hash=hash_password(temp_password),
        organization_id=org.id, role=role, must_change_password=True,
        manage_global_admins=data.manage_global_admins,
        can_delete_data=data.can_delete_data,
    )
    db.add(target); db.flush()
    audit_event(db, action="USER_CREATED", entity="user", entity_id=target.id,
                organization_id=target.organization_id, actor=user, request=request,
                target_user_id=target.id, role_after=target.role,
                details={"username": username})
    db.commit()
    return {**_user_payload(target), "temp_password": temp_password}


@router.patch("/users/{user_id}/role")
def set_role(
    user_id: int, data: UserRoleUpdate, request: Request, organization_id: int | None = None,
    user: User = Depends(require_admin), db: Session = Depends(get_db),
):
    target = _user_or_404(db, user_id, user, organization_id)
    if target.id == user.id:
        raise HTTPException(400, "نمی‌توانید نقش یا مجوز خودتان را تغییر دهید")
    _require_privileged_account_management(db, user, target)
    org = db.get(Organization, target.organization_id)
    _validate_role_change(db, user, org, data.role, data.manage_global_admins)
    if target.role == ROLE_GLOBAL_ADMIN or data.role == ROLE_GLOBAL_ADMIN:
        if not can_manage_global_admins(user, db):
            raise HTTPException(403, "مجوز manage_global_admins لازم است")
    before = target.role
    target.role = data.role
    target.manage_global_admins = data.manage_global_admins
    target.can_delete_data = data.can_delete_data
    if data.role != ROLE_GLOBAL_ADMIN:
        target.mfa_enabled = False; target.mfa_secret_enc = None; target.mfa_recovery_hashes = []
    target.token_version += 1
    audit_event(db, action="ROLE_CHANGED", entity="user", entity_id=target.id,
                organization_id=target.organization_id, actor=user, request=request,
                target_user_id=target.id, role_before=before, role_after=target.role,
                details={"username": target.username,
                         "manage_global_admins": target.manage_global_admins,
                         "can_delete_data": target.can_delete_data})
    db.commit()
    return {"ok": True, **_user_payload(target)}


@router.post("/users/{user_id}/toggle-admin")
def toggle_admin(
    user_id: int, request: Request,
    user: User = Depends(require_admin), db: Session = Depends(get_db),
):
    target = _user_or_404(db, user_id, user)
    new_role = ROLE_UNIT_USER if target.role == ROLE_UNIT_MANAGER else ROLE_UNIT_MANAGER
    return set_role(user_id, UserRoleUpdate(role=new_role, can_delete_data=new_role == ROLE_UNIT_MANAGER),
                    request, None, user, db)


@router.patch("/users/{user_id}/credentials")
def set_credentials(
    user_id: int, data: UserCredentialsIn, request: Request,
    user: User = Depends(require_admin), db: Session = Depends(get_db),
):
    target = _user_or_404(db, user_id, user)
    _require_privileged_account_management(db, user, target)
    changed = []
    username = data.username.strip().lower()
    if username and username != target.username:
        if db.query(User).filter(User.username == username, User.id != user_id).first():
            raise HTTPException(400, "این نام کاربری قبلاً ثبت شده است")
        target.username = username; changed.append("username")
    password = data.password.strip()
    if password:
        if not password_is_strong(password) or is_temp_password(password):
            raise HTTPException(400, "رمز باید حداقل ۱۰ نویسه باشد")
        target.password_hash = hash_password(password)
        target.must_change_password = False; target.token_version += 1; changed.append("password")
    if not changed:
        raise HTTPException(400, "چیزی برای تغییر فرستاده نشد")
    audit_event(db, action="CREDENTIALS_CHANGED", entity="user", entity_id=target.id,
                organization_id=target.organization_id, actor=user, request=request,
                target_user_id=target.id, details={"username": target.username, "fields": changed})
    db.commit()
    return {"ok": True, "username": target.username}


@router.post("/users/{user_id}/reset-password", response_model=TempPasswordOut)
def reset_password(
    user_id: int, request: Request,
    user: User = Depends(require_admin), db: Session = Depends(get_db),
):
    target = _user_or_404(db, user_id, user)
    _require_privileged_account_management(db, user, target)
    temp_password = gen_temp_password()
    target.password_hash = hash_password(temp_password)
    target.must_change_password = True; target.token_version += 1
    audit_event(db, action="PASSWORD_RESET", entity="user", entity_id=target.id,
                organization_id=target.organization_id, actor=user, request=request,
                target_user_id=target.id, details={"username": target.username})
    db.commit()
    return {"username": target.username, "temp_password": temp_password}


@router.post("/users/{user_id}/toggle-active")
def toggle_active(
    user_id: int, request: Request,
    user: User = Depends(require_admin), db: Session = Depends(get_db),
):
    target = _user_or_404(db, user_id, user)
    if target.id == user.id:
        raise HTTPException(400, "نمی‌توانید حساب خودتان را غیرفعال کنید")
    _require_privileged_account_management(db, user, target)
    target.is_active = not target.is_active; target.token_version += 1
    audit_event(db, action="ACCOUNT_STATUS_CHANGED", entity="user", entity_id=target.id,
                organization_id=target.organization_id, actor=user, request=request,
                target_user_id=target.id, details={"active": target.is_active, "username": target.username})
    db.commit()
    return {"ok": True, "is_active": target.is_active}


# ---------------- Import and audit ----------------

@router.post("/import", response_model=ImportResult)
async def import_file(
    request: Request, file: UploadFile = File(...), organization_id: int | None = None,
    user: User = Depends(require_admin), db: Session = Depends(get_db),
):
    org_id = _scope(user, organization_id, db, all_for_global=False)
    content = await file.read()
    if len(content) > 15 * 1024 * 1024:
        raise HTTPException(413, "حجم فایل بیش از ۱۵ مگابایت است")
    name = (file.filename or "").lower()
    try:
        records = parse_xlsx(content) if name.endswith((".xlsx", ".xls")) else parse_csv(content) if name.endswith(".csv") else None
        if records is None:
            raise HTTPException(400, "فقط فایل xlsx یا csv پذیرفته می‌شود")
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(400, f"خواندن فایل ناموفق بود: {exc}")
    result = apply_import(db, records, actor=user, organization_id=org_id)
    audit_event(db, action="IMPORT", entity="import", organization_id=org_id,
                actor=user, request=request, details={"file": file.filename, **result})
    db.commit()
    return result


@router.get("/logs")
def list_logs(
    request: Request, limit: int = 100, organization_id: int | None = None,
    user: User = Depends(require_admin), db: Session = Depends(get_db),
):
    scope = _scope(user, organization_id, db)
    query = db.query(ChangeLog)
    if scope is not None:
        query = query.filter(ChangeLog.organization_id == scope)
    rows = query.order_by(ChangeLog.id.desc()).limit(max(1, min(limit, 500))).all()
    audit_event(db, action="AUDIT_LOG_VIEW", entity="audit", actor=user,
                organization_id=scope, request=request,
                details={"count": len(rows), "all_units": scope is None})
    db.commit()
    return [{
        "id": r.id, "organization_id": r.organization_id, "entity": r.entity,
        "entity_id": r.entity_id, "action": r.action, "actor_name": r.actor_name,
        "actor_role": r.actor_role, "target_user_id": r.target_user_id,
        "role_before": r.role_before, "role_after": r.role_after,
        "details": r.details,
        "at": r.at.replace(tzinfo=r.at.tzinfo or timezone.utc).isoformat() if r.at else None,
    } for r in rows]
