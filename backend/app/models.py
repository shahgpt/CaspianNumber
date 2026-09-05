"""SQLAlchemy models: users, employees, change log."""
import secrets

from sqlalchemy import (JSON, Boolean, Column, DateTime, Integer, String, Text,
                        create_engine)
from sqlalchemy.orm import DeclarativeBase, sessionmaker
from sqlalchemy.sql import func

from .core.config import settings


class Base(DeclarativeBase):
    pass


engine = create_engine(
    settings.DATABASE_URL,
    connect_args={"check_same_thread": False} if settings.DATABASE_URL.startswith("sqlite") else {},
)
SessionLocal = sessionmaker(bind=engine, autoflush=False)


class User(Base):
    """حسابِ ورود — بدونِ آن هیچ‌چیزِ دفترچه دیده نمی‌شود.

    دو سطح بیشتر نداریم: کاربرِ عادی که فقط دفترچه را می‌خواند، و ادمین
    که پنلِ مدیریت را هم دارد. حسابِ تازه پیش‌فرض کاربرِ عادی است؛ ادمین
    شدن باید صریح باشد.
    """

    __tablename__ = "users"

    id = Column(Integer, primary_key=True)
    username = Column(String(64), unique=True, index=True, nullable=False)
    # فقط هش نگه داشته می‌شود. رمزِ خوانا هیچ‌جا ذخیره نمی‌شود — رمزِ موقتی
    # که ادمین می‌سازد یک‌بار در همان پاسخِ API دیده می‌شود و تمام.
    password_hash = Column(String(255), nullable=False)
    is_active = Column(Boolean, default=True)
    is_admin = Column(Boolean, default=False, nullable=False)
    # تا وقتی کاربر رمزِ موقت را عوض نکرده، فقط اجازه‌ی دیدن نشست و
    # فراخوانی endpoint تغییر رمز را دارد. این وضعیت باید در دیتابیس باشد؛
    # از روی هشِ رمز نمی‌شود موقتی‌بودن را با اطمینان تشخیص داد.
    must_change_password = Column(Boolean, default=False, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class Employee(Base):
    __tablename__ = "employees"

    id = Column(Integer, primary_key=True)
    first_name = Column(String(64), default="")
    last_name = Column(String(64), default="")
    latin_name = Column(String(128), default="")

    # شماره‌ی مستقیم: خطی که کاربر از موبایلش مستقیم می‌گیرد و به همان
    # داخلی می‌رسد. اگر خالی بماند از روی داخلی ساخته می‌شود.
    direct_number = Column(String(32), default="")
    extension = Column(String(16), default="")
    phone = Column(String(32), default="")
    email = Column(String(128), default="")

    department = Column(String(64), default="")
    company = Column(String(128), default="")
    job_title = Column(String(128), default="")
    location = Column(Text, default="")

    photo_url = Column(String(255), default="")
    keywords = Column(Text, default="")  # aliases & work keywords
    skills = Column(Text, default="")
    languages = Column(String(128), default="")
    working_hours = Column(String(128), default="")
    notes = Column(Text, default="")

    # normalized search corpus
    search_text = Column(Text, default="", index=True)

    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    @property
    def full_name(self) -> str:
        return " ".join(x for x in [self.first_name, self.last_name] if x).strip()

    @property
    def direct(self) -> str:
        """شماره‌ی مستقیم برای نمایش — ثبت‌شده، وگرنه ساخته‌شده از داخلی."""
        return (self.direct_number or "").strip() or direct_from_extension(self.extension)

    def sync_direct_number(self) -> None:
        """داخلی که هست و مستقیم که خالی است، خودش پر می‌شود."""
        if not (self.direct_number or "").strip():
            self.direct_number = direct_from_extension(self.extension)

    def rebuild_search_text(self) -> None:
        from .core.persian import normalize

        parts = [
            self.first_name, self.last_name, self.latin_name,
            self.department, self.company, self.job_title,
            self.keywords, self.skills, self.location, self.notes,
            self.direct_number, self.extension, self.phone, self.email,
        ]
        self.search_text = " ".join(normalize(p) for p in parts if p)


def direct_from_extension(extension: str | None) -> str:
    """۲۱۸ -> 02144218 — پیش‌شماره‌ی سازمان به داخلی می‌چسبد."""
    from .core.persian import normalize_keep_digits

    ext = normalize_keep_digits(extension or "")
    if not ext:
        return ""
    return f"{normalize_keep_digits(settings.DIRECT_PREFIX)}{ext}"


class ChangeLog(Base):
    __tablename__ = "change_log"

    id = Column(Integer, primary_key=True)
    entity = Column(String(32))          # employee | user | import
    entity_id = Column(Integer)
    action = Column(String(16))          # create | update | delete | import
    actor_id = Column(Integer)
    actor_name = Column(String(64))
    details = Column(JSON, nullable=True)
    at = Column(DateTime(timezone=True), server_default=func.now())


def gen_password(length: int = 8) -> str:
    alphabet = "abcdefghjkmnpqrstuvwxyz23456789"
    return "".join(secrets.choice(alphabet) for _ in range(length))


# رمزهای موقتی با این پیشوند ساخته می‌شوند تا ورود بتواند بشناسدشان و
# کاربر را سرِ اولین ورود پای تغییر رمز بنشاند (auth.login).
TEMP_PASSWORD_PREFIX = "tmp-"


def gen_temp_password() -> str:
    """رمزِ یک‌بارمصرفِ ادمین‌ساخته — فقط همان لحظه دیده می‌شود."""
    return f"{TEMP_PASSWORD_PREFIX}{gen_password()}"


def is_temp_password(raw: str) -> bool:
    return (raw or "").startswith(TEMP_PASSWORD_PREFIX)


def _migrate_sqlite() -> None:
    """مهاجرت‌های کوچکِ درجا — پروژه Alembic ندارد و لازم هم نداشت.

    ۱) ستون‌های تازه اضافه می‌شوند اگر نبودند.
    ۲) «موبایل» جای خود را به «شماره‌ی مستقیم» می‌دهد: مقدارِ قبلی دور
       ریخته می‌شود چون شماره‌ی شخصی بود، نه شماره‌ی سازمانی — و مستقیم
       از روی داخلی دوباره ساخته می‌شود.
    ۳) ستونِ رمزِ خوانا برداشته می‌شود؛ رمزها فقط هش می‌مانند.
    ۴) نقشِ رشته‌ای برداشته می‌شود و جایش `is_admin` می‌نشیند.
    ۵) وضعیتِ اجبار به تغییر رمز اضافه می‌شود.
    """
    from sqlalchemy import text

    with engine.begin() as conn:
        emp_cols = {r[1] for r in conn.execute(text("PRAGMA table_info(employees)"))}
        if emp_cols:
            if "direct_number" not in emp_cols:
                conn.execute(text("ALTER TABLE employees ADD COLUMN direct_number VARCHAR(32) DEFAULT ''"))
            if "mobile" in emp_cols:
                conn.execute(text("ALTER TABLE employees DROP COLUMN mobile"))

        user_cols = {r[1] for r in conn.execute(text("PRAGMA table_info(users)"))}
        if "password_plain" in user_cols:
            # اول مقدارها را پاک می‌کنیم بعد ستون را برمی‌داریم: اگر
            # DROP COLUMN روی SQLiteی قدیمی (<3.35) نگیرد، دست‌کم رمزِ
            # خوانایی در فایل باقی نمانده باشد.
            conn.execute(text("UPDATE users SET password_plain = ''"))
            try:
                conn.execute(text("ALTER TABLE users DROP COLUMN password_plain"))
            except Exception:
                pass  # ستونِ خالیِ بلااستفاده می‌ماند — مدل دیگر نمی‌شناسدش
            user_cols = {r[1] for r in conn.execute(text("PRAGMA table_info(users)"))}

        if "role" in user_cols or "employee_id" in user_cols:
            _drop_non_admin_accounts(conn)
            user_cols = {r[1] for r in conn.execute(text("PRAGMA table_info(users)"))}

        if "is_admin" not in user_cols:
            # پیش از این مهاجرت، «حساب داشتن» یعنی ادمین بودن — پس هرکه
            # حساب دارد ادمین می‌ماند، وگرنه کسی به پنل راه ندارد.
            conn.execute(text("ALTER TABLE users ADD COLUMN is_admin BOOLEAN NOT NULL DEFAULT 0"))
            conn.execute(text("UPDATE users SET is_admin = 1"))

        if "must_change_password" not in user_cols:
            # حساب‌های قدیمی دائمی فرض می‌شوند. اگر رمزِ قدیمی واقعاً موقت
            # باشد، login با دیدن پیشوند tmp- همین پرچم را روشن می‌کند.
            conn.execute(text(
                "ALTER TABLE users ADD COLUMN must_change_password "
                "BOOLEAN NOT NULL DEFAULT 0"
            ))


def _drop_non_admin_accounts(conn) -> None:
    """ستونِ `role` برداشته می‌شود و فقط ادمین‌ها می‌مانند.

    حساب‌های `employee`/`hr` آن دوره هیچ اجازه‌ای نمی‌دادند (دفترچه ورود
    نمی‌خواست) و رمزشان هم دستِ کسی نیست؛ پس نگه‌داشتنشان بی‌معناست.
    حساب‌های تازه‌ی کارمندی از پنل ساخته می‌شوند.

    این فقط ردیفِ ورود را می‌برد: جدولِ `employees` — یعنی خودِ دفترچه و
    همه‌ی شماره‌ها — دست نمی‌خورد.

    ستونِ `employee_id` کلید خارجی دارد و SQLite نمی‌گذارد مستقیم DROP
    شود، پس جدول از نو ساخته می‌شود.
    """
    from sqlalchemy import text

    kept = conn.execute(text("SELECT count(*) FROM users WHERE role = 'admin'")).scalar()
    dropped = conn.execute(text("SELECT count(*) FROM users WHERE role != 'admin'")).scalar()

    conn.execute(text("""
        CREATE TABLE users_new (
            id INTEGER NOT NULL PRIMARY KEY,
            username VARCHAR(64) NOT NULL,
            password_hash VARCHAR(255) NOT NULL,
            is_active BOOLEAN,
            created_at DATETIME
        )
    """))
    conn.execute(text("""
        INSERT INTO users_new (id, username, password_hash, is_active, created_at)
        SELECT id, username, password_hash, is_active, created_at
        FROM users WHERE role = 'admin'
    """))
    conn.execute(text("DROP TABLE users"))
    conn.execute(text("ALTER TABLE users_new RENAME TO users"))
    conn.execute(text("CREATE UNIQUE INDEX ix_users_username ON users (username)"))
    print(f"[migrate] حساب‌ها فقط ادمین شدند — {kept} ماند، {dropped} حسابِ کارمندی حذف شد")


def backfill_direct_numbers() -> None:
    """هر کسی که داخلی دارد و مستقیمش خالی است، شماره‌اش ساخته می‌شود."""
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
    # make sure the sqlite folder exists (first run on a fresh clone)
    if engine.url.drivername.startswith("sqlite"):
        import os

        db_path = engine.url.database
        if db_path:
            os.makedirs(os.path.dirname(os.path.abspath(db_path)), exist_ok=True)
    Base.metadata.create_all(engine)
    if engine.url.drivername.startswith("sqlite"):
        _migrate_sqlite()
    backfill_direct_numbers()
    try:
        reindex_fts()
    except Exception:
        pass  # FTS اختیاری است — LIKE fallback داریم
