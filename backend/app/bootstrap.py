"""Create the default admin account on first run."""
import os

from sqlalchemy.orm import Session

from .core.config import settings
from .models import User
from .security import hash_password


def ensure_admin(db: Session) -> None:
    # تا وقتی یک ادمین هست کاری لازم نیست. شرط روی «ادمین» است نه
    # «حساب»، وگرنه اولین کارمندی که ساخته شود جلوی ساختِ ادمین را می‌گیرد.
    if db.query(User).filter(User.is_admin.is_(True)).first():
        return
    username = (os.environ.get("ADMIN_USERNAME") or settings.ADMIN_USERNAME).lower()
    password = os.environ.get("ADMIN_PASSWORD") or settings.ADMIN_PASSWORD
    db.add(
        User(
            username=username,
            password_hash=hash_password(password),
            is_admin=True,
        )
    )
    db.commit()
    print(f"[init] default admin created -> {username}/{password}")
