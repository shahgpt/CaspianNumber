from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import PlainTextResponse
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import Employee
from ..schemas import EmployeeOut
from ..security import require_password_changed, resolve_scope_organization
from ..audit import audit_event
from ..core.persian import normalize_keep_digits

# دفترچه پشتِ ورود است: هر کارمند حسابِ خودش را دارد و بدون توکنِ معتبر
# هیچ شماره‌ای از اینجا بیرون نمی‌رود.
router = APIRouter(
    prefix="/api/employees",
    tags=["employees"],
    dependencies=[Depends(require_password_changed)],
)


def _digits(s: str) -> str:
    return normalize_keep_digits(s)


@router.get("", response_model=list[EmployeeOut])
def list_employees(
    request: Request,
    q: str = "",
    limit: int = 30,
    offset: int = 0,
    organization_id: int | None = None,
    user=Depends(require_password_changed),
    db: Session = Depends(get_db),
):
    from ..search import search_employees

    limit = max(1, min(limit, 100))
    offset = max(0, offset)

    scope = resolve_scope_organization(user, organization_id, db)
    if q.strip():
        rows = search_employees(db, q, limit=limit, offset=offset, organization_id=scope)
    else:
        query = db.query(Employee)
        if scope is not None:
            query = query.filter(Employee.organization_id == scope)
        rows = (
            query
            .order_by(Employee.last_name, Employee.id)
            .offset(offset)
            .limit(limit)
            .all()
        )
    audit_event(db, action="DIRECTORY_VIEW", entity="employee", actor=user,
                organization_id=scope, request=request,
                details={"query": q[:100], "offset": offset, "count": len(rows), "all_units": scope is None})
    db.commit()
    return rows


@router.get("/{emp_id}/vcard")
def vcard(
    emp_id: int,
    request: Request,
    organization_id: int | None = None,
    user=Depends(require_password_changed),
    db: Session = Depends(get_db),
):
    scope = resolve_scope_organization(user, organization_id, db)
    query = db.query(Employee).filter(Employee.id == emp_id)
    if scope is not None:
        query = query.filter(Employee.organization_id == scope)
    emp = query.first()
    if not emp:
        raise HTTPException(404, "یافت نشد")
    audit_event(db, action="VCARD_VIEW", entity="employee", entity_id=emp.id,
                organization_id=emp.organization_id, actor=user, request=request)
    db.commit()

    def esc(s):
        return (s or "").replace("\\", "\\\\").replace(",", "\\,").replace(";", "\\;").replace("\n", "\\n")

    lines = [
        "BEGIN:VCARD",
        "VERSION:3.0",
        f"N:{esc(emp.last_name)};{esc(emp.first_name)};;;",
        f"FN:{esc(emp.full_name)}",
    ]
    if emp.latin_name:
        parts = emp.latin_name.split()
        if len(parts) >= 2:
            lines.append(f"N-LAST;X-ALT:N:{parts[-1]};{' '.join(parts[:-1])};;;")
        lines.append(f"X-LATIN-NAME:{esc(emp.latin_name)}")
    if emp.direct:
        lines.append(f"TEL;TYPE=WORK;TYPE=VOICE:{_digits(emp.direct)}")
    if emp.phone:
        lines.append(f"TEL;TYPE=WORK:{_digits(emp.phone)}")
    if emp.extension:
        lines.append(f"TEL;TYPE=WORK;TYPE=EXT:{_digits(emp.phone or '')}Ext={_digits(emp.extension)}" if emp.phone else f"NOTE:داخلی: {_digits(emp.extension)}")
    if emp.email:
        lines.append(f"EMAIL;TYPE=WORK:{emp.email}")
    if emp.company:
        lines.append(f"ORG:{esc(emp.company)}")
    if emp.job_title:
        lines.append(f"TITLE:{esc(emp.job_title)}")
    if emp.department:
        lines.append(f"X-DEPARTMENT:{esc(emp.department)}")
    lines += [
        f"REV:{datetime.utcnow().strftime('%Y%m%dT%H%M%SZ')}",
        "END:VCARD",
    ]
    filename = (emp.latin_name.replace(" ", "_") or f"employee_{emp.id}") + ".vcf"
    return PlainTextResponse(
        "\r\n".join(lines) + "\r\n",
        media_type="text/vcard; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
