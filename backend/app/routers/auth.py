from __future__ import annotations

import time
from collections import defaultdict, deque

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session

from ..audit import audit_event
from ..database import get_db
from ..models import User, is_temp_password
from ..schemas import ChangePasswordIn, LoginIn, TokenOut, UserOut
from ..security import (
    create_access_token, get_current_user, hash_password, password_is_strong,
    verify_password,
)

router = APIRouter(prefix="/api/auth", tags=["auth"])
_attempts: dict[str, deque[float]] = defaultdict(deque)
_DUMMY_HASH = hash_password("not-a-real-password-93851")


def _rate_key(request: Request, username: str) -> str:
    ip = request.client.host if request.client else "unknown"
    return f"{ip}:{username.strip().lower()}"


def _enforce_rate(key: str) -> None:
    now = time.monotonic()
    q = _attempts[key]
    while q and now - q[0] > settings.LOGIN_WINDOW_SECONDS:
        q.popleft()
    if len(q) >= settings.LOGIN_MAX_ATTEMPTS:
        raise HTTPException(status_code=429, detail="تلاش‌های ورود بیش از حد است؛ کمی بعد دوباره امتحان کنید")


def _enforce_login_rate(request: Request, username: str) -> str:
    key = _rate_key(request, username)
    _enforce_rate(key)
    return key


def _user_payload(user: User) -> dict:
    return {
        "id": user.id,
        "username": user.username,
        "organization_id": user.organization_id,
        "organization_name": user.organization.name if user.organization else "",
        "role": user.role,
        "is_active": user.is_active,
        "is_admin": user.is_admin,
        "must_change_password": user.must_change_password,
        "is_root": user.is_root,
        "can_delete_data": user.can_delete_data,
    }


from ..core.config import settings  # noqa: E402 (after dummy hash initialization helpers)


@router.post("/login", response_model=TokenOut)
def login(data: LoginIn, request: Request, db: Session = Depends(get_db)):
    username = data.username.strip().lower()
    key = _enforce_login_rate(request, username)
    user = db.query(User).filter(User.username == username).first()
    password_ok = verify_password(data.password, user.password_hash if user else _DUMMY_HASH)
    if not user or not password_ok:
        _attempts[key].append(time.monotonic())
        audit_event(
            db, action="LOGIN_FAILED", entity="auth", actor=user,
            organization_id=user.organization_id if user else None,
            request=request, details={"attempted_username": username},
        )
        db.commit()
        raise HTTPException(status_code=401, detail="نام کاربری یا رمز عبور اشتباه است")
    if not user.is_active or not user.organization or not user.organization.is_active:
        audit_event(db, action="LOGIN_BLOCKED", entity="auth", actor=user, request=request)
        db.commit()
        raise HTTPException(status_code=403, detail="حساب یا واحد سازمانی شما غیرفعال است")

    must_change = is_temp_password(data.password)
    if must_change and not user.must_change_password:
        user.must_change_password = True

    _attempts.pop(key, None)
    audit_event(db, action="LOGIN_SUCCESS", entity="auth", actor=user, request=request)
    db.commit()
    return TokenOut(
        access_token=create_access_token(user),
        username=user.username,
        must_change_password=bool(user.must_change_password),
    )


@router.get("/me", response_model=UserOut)
def me(user: User = Depends(get_current_user)):
    return _user_payload(user)


@router.post("/change-password")
def change_password(
    data: ChangePasswordIn,
    request: Request,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if not verify_password(data.current_password, user.password_hash):
        raise HTTPException(status_code=400, detail="رمز فعلی اشتباه است")
    if not password_is_strong(data.new_password):
        raise HTTPException(status_code=400, detail="رمز جدید باید حداقل ۱۰ نویسه باشد")
    if is_temp_password(data.new_password):
        raise HTTPException(status_code=400, detail="رمز جدید نمی‌تواند با «tmp-» شروع شود")
    user.password_hash = hash_password(data.new_password)
    user.must_change_password = False
    # Invalidate every previously issued token. The response carries the sole
    # fresh token that the client should keep after a password change.
    user.token_version += 1
    audit_event(db, action="PASSWORD_CHANGED", entity="user", actor=user, entity_id=user.id, request=request)
    db.commit()
    return {"ok": True, "access_token": create_access_token(user)}
