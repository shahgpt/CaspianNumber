"""Authentication, authorization, tenant scoping and TOTP helpers."""
from __future__ import annotations

import base64
import hashlib
import hmac
import secrets
import struct
import time
from urllib.parse import quote, urlencode
from datetime import datetime, timedelta, timezone

from cryptography.fernet import Fernet, InvalidToken
from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from jose import JWTError, jwt
from passlib.context import CryptContext
from sqlalchemy.orm import Session

from .core.config import settings
from .database import get_db
from .models import (
    ORG_HEAD_OFFICE,
    ROLE_GLOBAL_ADMIN,
    ROLE_HEAD_OFFICE_ACCESS_ADMIN,
    ROLE_UNIT_MANAGER,
    Organization,
    User,
)

# bcrypt_sha256 avoids bcrypt's 72-byte password truncation while continuing
# to verify hashes created by earlier releases with plain bcrypt.
pwd_context = CryptContext(schemes=["bcrypt_sha256", "bcrypt"], deprecated="auto")
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/login")
ALGORITHM = "HS256"
MANAGER_ROLES = {ROLE_UNIT_MANAGER, ROLE_HEAD_OFFICE_ACCESS_ADMIN, ROLE_GLOBAL_ADMIN}


def hash_password(raw: str) -> str:
    return pwd_context.hash(raw)


def verify_password(raw: str, hashed: str) -> bool:
    try:
        return pwd_context.verify(raw, hashed)
    except Exception:
        return False


def password_is_strong(raw: str) -> bool:
    # Length is the primary policy; passphrases without digits remain valid.
    return len(raw) >= 10


def _encode_token(user: User, purpose: str, minutes: int, *, mfa: bool = False) -> str:
    now = datetime.now(timezone.utc)
    return jwt.encode(
        {
            "sub": str(user.id),
            "username": user.username,
            "purpose": purpose,
            "ver": user.token_version,
            "mfa": mfa,
            "iat": now,
            "exp": now + timedelta(minutes=minutes),
        },
        settings.SECRET_KEY,
        algorithm=ALGORITHM,
    )


def create_access_token(user: User, *, mfa_verified: bool = False) -> str:
    return _encode_token(
        user,
        "access",
        settings.ACCESS_TOKEN_EXPIRE_MINUTES,
        mfa=mfa_verified or user.role != ROLE_GLOBAL_ADMIN,
    )


def create_mfa_token(user: User, purpose: str) -> str:
    if purpose not in {"mfa_challenge", "mfa_setup"}:
        raise ValueError("invalid MFA token purpose")
    return _encode_token(user, purpose, settings.MFA_TOKEN_EXPIRE_MINUTES)


def decode_user_token(token: str, db: Session, *, purpose: str) -> tuple[User, dict]:
    credentials_error = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="اعتبارسنجی ناموفق بود",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = jwt.decode(token, settings.SECRET_KEY, algorithms=[ALGORITHM])
        if payload.get("purpose") != purpose:
            raise credentials_error
        user_id = int(payload.get("sub"))
    except (JWTError, TypeError, ValueError):
        raise credentials_error
    user = db.get(User, user_id)
    if user is None or not user.is_active:
        raise credentials_error
    organization = db.get(Organization, user.organization_id)
    if organization is None or not organization.is_active:
        raise credentials_error
    if payload.get("ver") != user.token_version:
        if user.must_change_password:
            raise HTTPException(status_code=403, detail="ابتدا باید رمز عبور موقت خود را تغییر دهید")
        raise credentials_error
    return user, payload


def get_current_user(token: str = Depends(oauth2_scheme), db: Session = Depends(get_db)) -> User:
    user, payload = decode_user_token(token, db, purpose="access")
    if user.role == ROLE_GLOBAL_ADMIN and (not user.mfa_enabled or not payload.get("mfa")):
        raise HTTPException(status_code=401, detail="تأیید دومرحله‌ای مدیر کل الزامی است")
    return user


def require_password_changed(user: User = Depends(get_current_user)) -> User:
    if user.must_change_password:
        raise HTTPException(status_code=403, detail="ابتدا باید رمز عبور موقت خود را تغییر دهید")
    return user


def require_admin(user: User = Depends(require_password_changed)) -> User:
    """Backward-compatible name for the management-role guard."""
    if user.role not in MANAGER_ROLES:
        raise HTTPException(status_code=403, detail="دسترسی مدیریتی ندارید")
    return user


def require_global_admin(user: User = Depends(require_password_changed)) -> User:
    if user.role != ROLE_GLOBAL_ADMIN:
        raise HTTPException(status_code=403, detail="این عملیات فقط برای مدیر کل سامانه مجاز است")
    return user


def can_manage_global_admins(user: User, db: Session) -> bool:
    org = db.get(Organization, user.organization_id)
    return bool(
        org
        and org.kind == ORG_HEAD_OFFICE
        and user.manage_global_admins
        and user.role in {ROLE_HEAD_OFFICE_ACCESS_ADMIN, ROLE_GLOBAL_ADMIN}
    )


def resolve_scope_organization(
    user: User,
    requested_organization_id: int | None,
    db: Session,
    *,
    allow_all_for_global: bool = True,
) -> int | None:
    """Return the only permitted tenant scope; never trust a client tenant id."""
    if user.role == ROLE_GLOBAL_ADMIN:
        if requested_organization_id is None:
            if allow_all_for_global:
                return None
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="برای عملیات تغییردهنده، واحد مقصد را انتخاب کنید",
            )
        org_id = requested_organization_id
        org = db.get(Organization, org_id)
        if not org or not org.is_active:
            raise HTTPException(status_code=404, detail="واحد سازمانی یافت نشد")
        return org.id
    if requested_organization_id is not None and requested_organization_id != user.organization_id:
        # 404 avoids confirming that another tenant's identifier exists.
        raise HTTPException(status_code=404, detail="یافت نشد")
    return user.organization_id


def _fernet() -> Fernet:
    key = base64.urlsafe_b64encode(hashlib.sha256(settings.SECRET_KEY.encode()).digest())
    return Fernet(key)


def encrypt_mfa_secret(secret: str) -> str:
    return _fernet().encrypt(secret.encode()).decode()


def decrypt_mfa_secret(value: str) -> str:
    try:
        return _fernet().decrypt(value.encode()).decode()
    except (InvalidToken, ValueError):
        raise HTTPException(status_code=500, detail="کلید MFA قابل خواندن نیست")


def verify_totp(user: User, code: str) -> bool:
    if not user.mfa_secret_enc:
        return False
    secret = decrypt_mfa_secret(user.mfa_secret_enc)
    supplied = (code or "").replace(" ", "")
    if not supplied.isdigit() or len(supplied) != 6:
        return False
    counter = int(time.time()) // 30
    return any(hmac.compare_digest(supplied, _totp_at(secret, counter + offset)) for offset in (-1, 0, 1))


def generate_totp_secret() -> str:
    return base64.b32encode(secrets.token_bytes(20)).decode().rstrip("=")


def _totp_at(secret: str, counter: int) -> str:
    padded = secret + "=" * ((8 - len(secret) % 8) % 8)
    key = base64.b32decode(padded, casefold=True)
    digest = hmac.new(key, struct.pack(">Q", counter), hashlib.sha1).digest()
    offset = digest[-1] & 0x0F
    value = (struct.unpack(">I", digest[offset:offset + 4])[0] & 0x7FFFFFFF) % 1_000_000
    return f"{value:06d}"


def totp_provisioning_uri(secret: str, username: str, issuer: str) -> str:
    label = quote(f"{issuer}:{username}")
    return f"otpauth://totp/{label}?{urlencode({'secret': secret, 'issuer': issuer, 'digits': 6, 'period': 30})}"


def generate_recovery_codes(count: int = 8) -> tuple[list[str], list[str]]:
    raw = [f"{secrets.token_hex(4)}-{secrets.token_hex(4)}" for _ in range(count)]
    return raw, [hash_password(code) for code in raw]


def consume_recovery_code(user: User, code: str) -> bool:
    hashes = list(user.mfa_recovery_hashes or [])
    for idx, hashed in enumerate(hashes):
        if verify_password(code, hashed):
            hashes.pop(idx)
            user.mfa_recovery_hashes = hashes
            return True
    return False
