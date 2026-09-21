"""Validated public API contracts. Tenant ids are absent from business-data writes."""
from typing import Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator

from .models import ROLE_UNIT_USER


class LoginIn(BaseModel):
    username: str = Field(min_length=1, max_length=64)
    password: str = Field(min_length=1, max_length=256)


class TokenOut(BaseModel):
    access_token: str = ""
    token_type: str = "bearer"
    username: str
    must_change_password: bool = False


class ChangePasswordIn(BaseModel):
    current_password: str = Field(min_length=1, max_length=256)
    new_password: str = Field(min_length=10, max_length=256)


class EmployeeBase(BaseModel):
    model_config = ConfigDict(extra="forbid")
    first_name: str = Field(default="", max_length=64)
    last_name: str = Field(default="", max_length=64)
    latin_name: str = Field(default="", max_length=128)
    direct_number: str = Field(default="", max_length=32)
    extension: str = Field(default="", max_length=16)
    phone: str = Field(default="", max_length=32)
    email: str = Field(default="", max_length=128)
    department: str = Field(default="", max_length=64)
    company: str = Field(default="", max_length=128)
    job_title: str = Field(default="", max_length=128)
    location: str = Field(default="", max_length=2000)
    photo_url: str = Field(default="", max_length=255)
    keywords: str = Field(default="", max_length=4000)
    skills: str = Field(default="", max_length=4000)
    languages: str = Field(default="", max_length=128)
    working_hours: str = Field(default="", max_length=128)
    notes: str = Field(default="", max_length=8000)

    @field_validator("email")
    @classmethod
    def validate_email_shape(cls, value: str) -> str:
        value = value.strip()
        if value and ("@" not in value or value.startswith("@") or value.endswith("@")):
            raise ValueError("ایمیل معتبر نیست")
        return value


class EmployeeCreate(EmployeeBase):
    pass


class EmployeeUpdate(EmployeeBase):
    pass


class EmployeeOut(EmployeeBase):
    model_config = ConfigDict(extra="forbid", from_attributes=True)
    id: int
    organization_id: int
    full_name: str
    direct: str = ""

class OrganizationOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    name: str
    code: str
    kind: str
    is_active: bool

class OrganizationCreate(BaseModel):
    name: str = Field(min_length=2, max_length=128)
    code: str = Field(min_length=2, max_length=24, pattern=r"^[A-Za-z0-9_-]+$")
    kind: str = "FACTORY"


class OrganizationUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: Optional[str] = Field(default=None, min_length=2, max_length=128)
    code: Optional[str] = Field(default=None, min_length=2, max_length=24, pattern=r"^[A-Za-z0-9_-]+$")
    kind: Optional[str] = Field(default=None, min_length=2, max_length=24)
    is_active: Optional[bool] = None


class OrganizationKindOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    code: str
    name: str
    is_system: bool
    sort_order: int = 100
    # How many units currently carry this type. A type in use cannot be deleted,
    # and the panel should say so before the button is pressed.
    usage_count: int = 0


class OrganizationKindCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str = Field(min_length=1, max_length=64)
    code: str = Field(min_length=2, max_length=24, pattern=r"^[A-Za-z0-9_-]+$")
    sort_order: int = 100


class OrganizationKindUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: Optional[str] = Field(default=None, min_length=1, max_length=64)
    # The code of a system type is load-bearing and stays put; see the router.
    code: Optional[str] = Field(default=None, min_length=2, max_length=24, pattern=r"^[A-Za-z0-9_-]+$")
    sort_order: Optional[int] = None


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    username: str
    organization_id: int
    organization_name: str = ""
    role: str
    is_active: bool
    is_admin: bool = False
    must_change_password: bool = False
    is_root: bool = False
    can_delete_data: bool = False

class UserCreatedOut(UserOut):
    temp_password: str


class TempPasswordOut(BaseModel):
    username: str
    temp_password: str


class UserCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    username: str = Field(min_length=1, max_length=64)
    organization_id: Optional[int] = None
    role: str = ROLE_UNIT_USER
    can_delete_data: bool = False
    # Legacy client field. True maps only to UNIT_MANAGER, never GLOBAL_ADMIN.
    is_admin: Optional[bool] = None


class UserRoleUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    role: str
    can_delete_data: bool = False


class UserCredentialsIn(BaseModel):
    username: str = Field(default="", max_length=64)
    password: str = Field(default="", max_length=256)


class BulkDeleteIn(BaseModel):
    ids: list[int] = Field(default_factory=list, max_length=500)


class ImportResult(BaseModel):
    created: int = 0
    updated: int = 0
    skipped: int = 0
    errors: list[str] = Field(default_factory=list)


class SuggestOut(BaseModel):
    keywords: str = ""
    skills: str = ""
    languages: str = ""
    notes: str = ""
