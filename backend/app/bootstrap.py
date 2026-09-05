"""Create the head office and its initial access administrator."""
import os

from sqlalchemy.orm import Session

from .core.config import settings
from .models import ORG_HEAD_OFFICE, ROLE_HEAD_OFFICE_ACCESS_ADMIN, Organization, User
from .security import hash_password


def ensure_admin(db: Session) -> None:
    head = db.query(Organization).filter(Organization.code == settings.HEAD_OFFICE_CODE).first()
    if not head:
        head = Organization(name=settings.HEAD_OFFICE_NAME, code=settings.HEAD_OFFICE_CODE, kind=ORG_HEAD_OFFICE)
        db.add(head)
        db.flush()

    username = (os.environ.get("ADMIN_USERNAME") or settings.ADMIN_USERNAME).strip().lower()
    existing = db.query(User).filter(User.username == username).first()
    if existing:
        if existing.organization_id == head.id and existing.role == "UNIT_MANAGER":
            existing.role = ROLE_HEAD_OFFICE_ACCESS_ADMIN
            existing.manage_global_admins = True
            existing.can_delete_data = True
        db.commit()
        return

    password = os.environ.get("ADMIN_PASSWORD") or settings.ADMIN_PASSWORD
    db.add(User(
        username=username,
        password_hash=hash_password(password),
        organization_id=head.id,
        role=ROLE_HEAD_OFFICE_ACCESS_ADMIN,
        manage_global_admins=True,
        can_delete_data=True,
    ))
    db.commit()
    print(f"[init] head-office access admin created: {username}")
