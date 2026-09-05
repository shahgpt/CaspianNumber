from __future__ import annotations

import time
from collections import defaultdict, deque

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session

from ..audit import audit_event
from ..database import get_db
from ..models import ROLE_GLOBAL_ADMIN, User, is_temp_password
from ..schemas import (
    ChangePasswordIn, LoginIn, MfaEnableIn, MfaEnabledOut, MfaSetupOut,
    MfaTokenIn, MfaVerifyIn, TokenOut, UserOut,
)
from ..security import (
    consume_recovery_code, create_access_token, create_mfa_token,
    decode_user_token, encrypt_mfa_secret, generate_recovery_codes,
    get_current_user, hash_password, password_is_strong, verify_password,
    verify_totp, generate_totp_secret, totp_provisioning_uri,
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


def _mfa_rate_key(request: Request, user: User, purpose: str) -> str:
    ip = request.client.host if request.client else "unknown"
    return f"{purpose}:{ip}:{user.id}"


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
        "manage_global_admins": user.manage_global_admins,
        "can_delete_data": user.can_delete_data,
        "mfa_enabled": user.mfa_enabled,
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

    if user.role == ROLE_GLOBAL_ADMIN:
        if not user.mfa_enabled:
            audit_event(db, action="MFA_SETUP_REQUIRED", entity="auth", actor=user, request=request)
            db.commit()
            return TokenOut(
                username=user.username,
                must_change_password=user.must_change_password,
                mfa_setup_required=True,
                mfa_token=create_mfa_token(user, "mfa_setup"),
            )
        verified = verify_totp(user, data.otp) if data.otp else False
        if not verified and data.recovery_code:
            verified = consume_recovery_code(user, data.recovery_code)
        if not verified:
            if data.otp or data.recovery_code:
                _attempts[key].append(time.monotonic())
            audit_event(db, action="MFA_CHALLENGE", entity="auth", actor=user, request=request)
            db.commit()
            return TokenOut(
                username=user.username,
                must_change_password=user.must_change_password,
                mfa_required=True,
                mfa_token=create_mfa_token(user, "mfa_challenge"),
            )

    _attempts.pop(key, None)
    audit_event(db, action="LOGIN_SUCCESS", entity="auth", actor=user, request=request)
    db.commit()
    return TokenOut(
        access_token=create_access_token(user, mfa_verified=user.role == ROLE_GLOBAL_ADMIN),
        username=user.username,
        must_change_password=bool(user.must_change_password),
    )


@router.post("/mfa/verify", response_model=TokenOut)
def verify_mfa(data: MfaVerifyIn, request: Request, db: Session = Depends(get_db)):
    user, _ = decode_user_token(data.mfa_token, db, purpose="mfa_challenge")
    rate_key = _mfa_rate_key(request, user, "mfa")
    _enforce_rate(rate_key)
    verified = verify_totp(user, data.code) if data.code else False
    if not verified and data.recovery_code:
        verified = consume_recovery_code(user, data.recovery_code)
    if user.role != ROLE_GLOBAL_ADMIN or not verified:
        _attempts[rate_key].append(time.monotonic())
        audit_event(db, action="MFA_FAILED", entity="auth", actor=user, request=request)
        db.commit()
        raise HTTPException(status_code=401, detail="کد تأیید صحیح نیست")
    _attempts.pop(rate_key, None)
    audit_event(db, action="MFA_SUCCESS", entity="auth", actor=user, request=request)
    db.commit()
    return TokenOut(
        access_token=create_access_token(user, mfa_verified=True),
        username=user.username,
        must_change_password=user.must_change_password,
    )


@router.post("/mfa/setup", response_model=MfaSetupOut)
def setup_mfa(data: MfaTokenIn, request: Request, db: Session = Depends(get_db)):
    user, _ = decode_user_token(data.mfa_token, db, purpose="mfa_setup")
    if user.role != ROLE_GLOBAL_ADMIN or user.mfa_enabled:
        raise HTTPException(status_code=403, detail="راه‌اندازی MFA برای این حساب مجاز نیست")
    secret = generate_totp_secret()
    user.mfa_secret_enc = encrypt_mfa_secret(secret)
    audit_event(db, action="MFA_SETUP_STARTED", entity="auth", actor=user, request=request)
    db.commit()
    uri = totp_provisioning_uri(secret, user.username, settings.APP_NAME)
    return MfaSetupOut(secret=secret, otpauth_uri=uri)


@router.post("/mfa/enable", response_model=MfaEnabledOut)
def enable_mfa(data: MfaEnableIn, request: Request, db: Session = Depends(get_db)):
    user, _ = decode_user_token(data.mfa_token, db, purpose="mfa_setup")
    rate_key = _mfa_rate_key(request, user, "mfa-setup")
    _enforce_rate(rate_key)
    if user.role != ROLE_GLOBAL_ADMIN or not user.mfa_secret_enc or not verify_totp(user, data.code):
        _attempts[rate_key].append(time.monotonic())
        raise HTTPException(status_code=400, detail="کد تأیید صحیح نیست")
    _attempts.pop(rate_key, None)
    recovery_codes, recovery_hashes = generate_recovery_codes()
    user.mfa_enabled = True
    user.mfa_recovery_hashes = recovery_hashes
    user.token_version += 1
    audit_event(db, action="MFA_ENABLED", entity="auth", actor=user, request=request)
    db.commit()
    return MfaEnabledOut(
        access_token=create_access_token(user, mfa_verified=True),
        username=user.username,
        must_change_password=user.must_change_password,
        recovery_codes=recovery_codes,
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
    return {"ok": True, "access_token": create_access_token(user, mfa_verified=user.role == ROLE_GLOBAL_ADMIN)}
