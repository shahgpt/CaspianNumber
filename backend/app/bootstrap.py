"""Create the head office and the single built-in root administrator."""
import os

from sqlalchemy.orm import Session

from .core.config import settings
from .models import ORG_HEAD_OFFICE, ROLE_GLOBAL_ADMIN, Organization, User
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
        # Upgrades land here: the bootstrap account becomes the root admin, and
        # stays it. Nothing else in the system can set or clear this flag.
        existing.is_root = True
        existing.role = ROLE_GLOBAL_ADMIN
        existing.can_delete_data = True
        existing.is_active = True
        db.commit()
        return

    password = os.environ.get("ADMIN_PASSWORD") or settings.ADMIN_PASSWORD
    db.add(User(
        username=username,
        password_hash=hash_password(password),
        organization_id=head.id,
        role=ROLE_GLOBAL_ADMIN,
        is_root=True,
        can_delete_data=True,
    ))
    db.commit()
    print(f"[init] root administrator created: {username}")
