"""Pydantic schemas for API request/response."""
from typing import Optional

from pydantic import BaseModel


class LoginIn(BaseModel):
    username: str
    password: str


class TokenOut(BaseModel):
    access_token: str
    token_type: str = "bearer"
    username: str
    must_change_password: bool = False


class ChangePasswordIn(BaseModel):
    current_password: str
    new_password: str


class EmployeeBase(BaseModel):
    first_name: str = ""
    last_name: str = ""
    latin_name: str = ""
    direct_number: str = ""
    extension: str = ""
    phone: str = ""
    email: str = ""
    department: str = ""
    company: str = ""
    job_title: str = ""
    location: str = ""
    photo_url: str = ""
    keywords: str = ""
    skills: str = ""
    languages: str = ""
    working_hours: str = ""
    notes: str = ""


class EmployeeCreate(EmployeeBase):
    pass


class EmployeeUpdate(EmployeeBase):
    pass


class EmployeeOut(EmployeeBase):
    id: int
    full_name: str
    # شماره‌ی مستقیمِ آماده‌ی تماس — ثبت‌شده، وگرنه ساخته‌شده از داخلی
    direct: str = ""

    class Config:
        from_attributes = True


class UserOut(BaseModel):
    id: int
    username: str
    is_active: bool
    is_admin: bool = False

    class Config:
        from_attributes = True


class UserCreatedOut(UserOut):
    """پاسخِ ساختِ کاربر — رمزِ موقت فقط همین یک‌بار برمی‌گردد."""

    temp_password: str


class TempPasswordOut(BaseModel):
    """رمزِ موقتِ تازه‌ساخته — نه ذخیره می‌شود و نه دوباره خوانده."""

    username: str
    temp_password: str


class UserCreate(BaseModel):
    """ساختِ حسابِ تازه — رمز گرفته نمی‌شود، سرور رمزِ موقت می‌سازد.

    پیش‌فرض کاربرِ عادی است؛ ادمین‌بودن باید صریح خواسته شود.
    """

    username: str
    is_admin: bool = False


class UserCredentialsIn(BaseModel):
    """ست‌کردنِ دستیِ نام کاربری و رمز از پنل مدیریت.

    هر کدام که خالی بماند، دست‌نخورده می‌ماند. رمز فقط هش می‌شود؛ بعد از
    ذخیره حتی ادمین هم دیگر آن را از سیستم نمی‌خواند.
    """

    username: str = ""
    password: str = ""


class BulkDeleteIn(BaseModel):
    """شناسه‌های انتخاب‌شده برای حذفِ دسته‌جمعی."""

    ids: list[int] = []


class ImportResult(BaseModel):
    created: int = 0
    updated: int = 0
    skipped: int = 0
    errors: list[str] = []


class SuggestOut(BaseModel):
    """فیلدهای توصیفیِ ساخته‌شده با مدل — پیشنهاد است، نه ذخیره‌ی نهایی."""

    keywords: str = ""
    skills: str = ""
    languages: str = ""
    notes: str = ""
