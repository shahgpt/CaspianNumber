"""Database models for organization-scoped identity, directory data and audit."""
from __future__ import annotations

import secrets

from sqlalchemy import (
    JSON, Boolean, Column, DateTime, ForeignKey, Index, Integer, String, Text,
    create_engine, event, text,
)
from sqlalchemy.orm import DeclarativeBase, relationship, sessionmaker
from sqlalchemy.sql import func

from .core.config import settings

ROLE_UNIT_USER = "UNIT_USER"
ROLE_UNIT_MANAGER = "UNIT_MANAGER"
ROLE_HEAD_OFFICE_ACCESS_ADMIN = "HEAD_OFFICE_ACCESS_ADMIN"
ROLE_GLOBAL_ADMIN = "GLOBAL_ADMIN"
VALID_ROLES = {ROLE_UNIT_USER, ROLE_UNIT_MANAGER, ROLE_HEAD_OFFICE_ACCESS_ADMIN, ROLE_GLOBAL_ADMIN}

ORG_HEAD_OFFICE = "HEAD_OFFICE"
ORG_FACTORY = "FACTORY"

# The two built-in unit types. They are rows in `organization_kinds` like any
# other, but they cannot be removed: HEAD_OFFICE decides where the two elevated
# roles may live, and FACTORY is what a unit falls back to. Their Persian labels
# are editable; their codes and existence are not.
SYSTEM_ORGANIZATION_KINDS: tuple[tuple[str, str], ...] = (
    (ORG_HEAD_OFFICE, "دفتر مرکزی"),
    (ORG_FACTORY, "کارخانه"),
)


class Base(DeclarativeBase):
    pass


engine = create_engine(
    settings.DATABASE_URL,
    connect_args={"check_same_thread": False} if settings.DATABASE_URL.startswith("sqlite") else {},
)
SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


if engine.url.drivername.startswith("sqlite"):
    @event.listens_for(engine, "connect")
    def _enable_sqlite_foreign_keys(dbapi_connection, _connection_record):
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()


class OrganizationKind(Base):
    """The vocabulary of unit types, managed from the admin panel.

    `kind` on an organization used to be a closed enum in this module, so adding
    a third type meant a code change. It is a lookup table now; the two system
    rows keep the behaviour the rest of the code depends on.
    """
    __tablename__ = "organization_kinds"

    id = Column(Integer, primary_key=True)
    # Mirrors the width of Organization.kind, which stores this code.
    code = Column(String(24), nullable=False, unique=True, index=True)
    name = Column(String(64), nullable=False)
    is_system = Column(Boolean, nullable=False, default=False)
    sort_order = Column(Integer, nullable=False, default=100)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class Organization(Base):
    __tablename__ = "organizations"

    id = Column(Integer, primary_key=True)
    name = Column(String(128), nullable=False, unique=True)
    code = Column(String(32), nullable=False, unique=True, index=True)
    kind = Column(String(24), nullable=False, default=ORG_FACTORY)
    is_active = Column(Boolean, nullable=False, default=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class User(Base):
    __tablename__ = "users"
    __table_args__ = (Index("ix_users_organization_role", "organization_id", "role"),)

    id = Column(Integer, primary_key=True)
    username = Column(String(64), unique=True, index=True, nullable=False)
    password_hash = Column(String(255), nullable=False)
    organization_id = Column(Integer, ForeignKey("organizations.id", ondelete="RESTRICT"), nullable=False, default=1, index=True)
    role = Column(String(40), nullable=False, default=ROLE_UNIT_USER)
    is_active = Column(Boolean, default=True, nullable=False)
    must_change_password = Column(Boolean, default=False, nullable=False)
    # The single built-in account. Set once at bootstrap and reachable through
    # no API, so the right to mint global admins cannot itself be handed out.
    is_root = Column(Boolean, default=False, nullable=False)
    can_delete_data = Column(Boolean, default=False, nullable=False)
    token_version = Column(Integer, default=0, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    organization = relationship("Organization")

    @property
    def is_admin(self) -> bool:
        """Compatibility field used by older clients and tests."""
        return self.role in {ROLE_UNIT_MANAGER, ROLE_HEAD_OFFICE_ACCESS_ADMIN, ROLE_GLOBAL_ADMIN}

    @is_admin.setter
    def is_admin(self, value: bool) -> None:
        self.role = ROLE_UNIT_MANAGER if value else ROLE_UNIT_USER

    @property
    def is_global_admin(self) -> bool:
        return self.role == ROLE_GLOBAL_ADMIN


class Employee(Base):
    __tablename__ = "employees"
    __table_args__ = (Index("ix_employees_org_last_name", "organization_id", "last_name", "id"),)

    id = Column(Integer, primary_key=True)
    organization_id = Column(Integer, ForeignKey("organizations.id", ondelete="RESTRICT"), nullable=False, default=1, index=True)
    first_name = Column(String(64), default="")
    last_name = Column(String(64), default="")
    latin_name = Column(String(128), default="")
    direct_number = Column(String(32), default="")
    extension = Column(String(16), default="")
    phone = Column(String(32), default="")
    email = Column(String(128), default="")
    department = Column(String(64), default="")
    company = Column(String(128), default="")
    job_title = Column(String(128), default="")
    location = Column(Text, default="")
    photo_url = Column(String(255), default="")
    keywords = Column(Text, default="")
    skills = Column(Text, default="")
    languages = Column(String(128), default="")
    working_hours = Column(String(128), default="")
    notes = Column(Text, default="")
    search_text = Column(Text, default="", index=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    organization = relationship("Organization")

    @property
    def full_name(self) -> str:
        return " ".join(x for x in [self.first_name, self.last_name] if x).strip()

    @property
    def direct(self) -> str:
        return (self.direct_number or "").strip() or direct_from_extension(self.extension)

    def sync_direct_number(self) -> None:
        if not (self.direct_number or "").strip():
            self.direct_number = direct_from_extension(self.extension)

    def rebuild_search_text(self) -> None:
        from .core.persian import normalize

        parts = [self.first_name, self.last_name, self.latin_name, self.department,
                 self.company, self.job_title, self.keywords, self.skills, self.location,
                 self.notes, self.direct_number, self.extension, self.phone, self.email]
        self.search_text = " ".join(normalize(p) for p in parts if p)


class ChangeLog(Base):
    """Append-only audit trail; the legacy table name is retained for upgrades."""
    __tablename__ = "change_log"
    __table_args__ = (
        Index("ix_audit_org_at", "organization_id", "at"),
        Index("ix_audit_actor_at", "actor_id", "at"),
    )

    id = Column(Integer, primary_key=True)
    organization_id = Column(Integer, ForeignKey("organizations.id"), nullable=True, index=True)
    entity = Column(String(32), nullable=False, default="system")
    entity_id = Column(Integer)
    action = Column(String(40), nullable=False)
    actor_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    actor_name = Column(String(64), nullable=False, default="system")
    actor_role = Column(String(40), nullable=True)
    target_user_id = Column(Integer, nullable=True)
    role_before = Column(String(40), nullable=True)
    role_after = Column(String(40), nullable=True)
    ip_address = Column(String(64), nullable=True)
    user_agent = Column(String(255), nullable=True)
    details = Column(JSON, nullable=True)
    at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)


def direct_from_extension(extension: str | None) -> str:
    from .core.persian import normalize_keep_digits
    ext = normalize_keep_digits(extension or "")
    return f"{normalize_keep_digits(settings.DIRECT_PREFIX)}{ext}" if ext else ""


def gen_password(length: int = 12) -> str:
    alphabet = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789!@#$%"
    return "".join(secrets.choice(alphabet) for _ in range(length))


TEMP_PASSWORD_PREFIX = "tmp-"


def gen_temp_password() -> str:
    return f"{TEMP_PASSWORD_PREFIX}{gen_password()}"


def is_temp_password(raw: str) -> bool:
    return (raw or "").startswith(TEMP_PASSWORD_PREFIX)


def _sqlite_columns(conn, table: str) -> set[str]:
    return {row[1] for row in conn.execute(text(f"PRAGMA table_info({table})"))}


def _drop_sqlite_column(conn, table: str, columns: set[str], name: str) -> None:
    """Remove a column the ORM no longer writes.

    `is_admin` is the case this exists for: created NOT NULL with no SQL default
    by an old `create_all`, then turned into a computed property. Left in place
    it rejects every INSERT. DROP COLUMN needs SQLite 3.35+; on anything older
    the column keeps whatever default it already had, which is the state that
    was working before.
    """
    if name not in columns:
        return
    try:
        conn.execute(text(f"ALTER TABLE {table} DROP COLUMN {name}"))
    except Exception:
        return
    columns.discard(name)


def _add_sqlite_column(conn, table: str, columns: set[str], name: str, ddl: str) -> None:
    if name not in columns:
        conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {name} {ddl}"))
        columns.add(name)


def _migrate_sqlite() -> None:
    """Idempotent bridge for installations created before Alembic was added."""
    with engine.begin() as conn:
        conn.execute(text("INSERT OR IGNORE INTO organizations(id,name,code,kind,is_active) VALUES (1,'دفتر مرکزی','HEAD','HEAD_OFFICE',1)"))

        emp_cols = _sqlite_columns(conn, "employees")
        if emp_cols:
            _add_sqlite_column(conn, "employees", emp_cols, "organization_id", "INTEGER NOT NULL DEFAULT 1")
            _add_sqlite_column(conn, "employees", emp_cols, "direct_number", "VARCHAR(32) DEFAULT ''")

        user_cols = _sqlite_columns(conn, "users")
        if user_cols:
            _add_sqlite_column(conn, "users", user_cols, "organization_id", "INTEGER NOT NULL DEFAULT 1")
            _add_sqlite_column(conn, "users", user_cols, "role", "VARCHAR(40) NOT NULL DEFAULT 'UNIT_USER'")
            _add_sqlite_column(conn, "users", user_cols, "is_root", "BOOLEAN NOT NULL DEFAULT 0")
            _add_sqlite_column(conn, "users", user_cols, "can_delete_data", "BOOLEAN NOT NULL DEFAULT 0")
            _add_sqlite_column(conn, "users", user_cols, "token_version", "INTEGER NOT NULL DEFAULT 0")
            _add_sqlite_column(conn, "users", user_cols, "must_change_password", "BOOLEAN NOT NULL DEFAULT 0")
            _add_sqlite_column(conn, "users", user_cols, "updated_at", "DATETIME")
            if "is_admin" in user_cols:
                conn.execute(text("UPDATE users SET role='UNIT_MANAGER', can_delete_data=1 WHERE is_admin=1 AND role='UNIT_USER'"))
                _drop_sqlite_column(conn, "users", user_cols, "is_admin")

        log_cols = _sqlite_columns(conn, "change_log")
        if log_cols:
            _add_sqlite_column(conn, "change_log", log_cols, "organization_id", "INTEGER")
            _add_sqlite_column(conn, "change_log", log_cols, "actor_role", "VARCHAR(40)")
            _add_sqlite_column(conn, "change_log", log_cols, "target_user_id", "INTEGER")
            _add_sqlite_column(conn, "change_log", log_cols, "role_before", "VARCHAR(40)")
            _add_sqlite_column(conn, "change_log", log_cols, "role_after", "VARCHAR(40)")
            _add_sqlite_column(conn, "change_log", log_cols, "ip_address", "VARCHAR(64)")
            _add_sqlite_column(conn, "change_log", log_cols, "user_agent", "VARCHAR(255)")
            conn.execute(text("UPDATE change_log SET organization_id=1 WHERE organization_id IS NULL"))


def seed_organization_kinds() -> None:
    """Make sure the two built-in unit types exist, without touching labels.

    An installation that renamed "کارخانه" keeps its label across restarts: only
    a missing row is inserted, and `is_system` is re-asserted so the protection
    survives a row that was created by hand.
    """
    db = SessionLocal()
    try:
        changed = False
        # Rows added below are not visible to a query until they are flushed, so
        # the set — not the database — is what says whether a code is spoken for.
        known = {row.code for row in db.query(OrganizationKind).all()}
        for order, (code, name) in enumerate(SYSTEM_ORGANIZATION_KINDS):
            if code not in known:
                db.add(OrganizationKind(code=code, name=name, is_system=True, sort_order=order))
                known.add(code)
                changed = True
                continue
            row = db.query(OrganizationKind).filter(OrganizationKind.code == code).first()
            if row is not None and not row.is_system:
                row.is_system = True
                changed = True
        # A unit whose type predates this table would otherwise show a raw code
        # in the panel forever, with no way to rename it.
        for (kind,) in db.query(Organization.kind).distinct():
            if kind and kind not in known:
                db.add(OrganizationKind(code=kind, name=kind, is_system=False, sort_order=100))
                known.add(kind)
                changed = True
        if changed:
            db.commit()
    finally:
        db.close()


def backfill_direct_numbers() -> None:
    db = SessionLocal()
    try:
        changed = False
        for emp in db.query(Employee).all():
            before = emp.direct_number
            emp.sync_direct_number()
            if emp.direct_number != before:
                emp.rebuild_search_text()
                changed = True
        if changed:
            db.commit()
    finally:
        db.close()


def reindex_fts() -> int:
    from . import fts
    db = SessionLocal()
    try:
        return fts.reindex_all(db)
    finally:
        db.close()


def init_db() -> None:
    if engine.url.drivername.startswith("sqlite"):
        import os
        db_path = engine.url.database
        if db_path:
            os.makedirs(os.path.dirname(os.path.abspath(db_path)), exist_ok=True)
    Base.metadata.create_all(engine)
    if engine.url.drivername.startswith("sqlite"):
        _migrate_sqlite()
    seed_organization_kinds()
    backfill_direct_numbers()
    try:
        reindex_fts()
    except Exception:
        pass
