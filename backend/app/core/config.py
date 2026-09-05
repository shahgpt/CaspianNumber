"""Application configuration via environment variables."""
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

# CaspianNumber/ project root (config.py -> core -> app -> backend -> root)
BASE_DIR = Path(__file__).resolve().parents[3]
_DEFAULT_DB = f"sqlite:///{BASE_DIR / 'backend' / 'data' / 'caspian.db'}"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=str(BASE_DIR / ".env"))
    APP_NAME: str = "Caspian Number"
    ENVIRONMENT: str = "development"
    SECRET_KEY: str = "change-me-in-production"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60 * 12
    MFA_TOKEN_EXPIRE_MINUTES: int = 10
    LOGIN_MAX_ATTEMPTS: int = 8
    LOGIN_WINDOW_SECONDS: int = 300
    CORS_ORIGINS: str = "http://127.0.0.1:5173,http://localhost:5173"

    DATABASE_URL: str = _DEFAULT_DB

    # شماره‌ی مستقیم از روی داخلی ساخته می‌شود: پیش‌شماره + داخلی
    # مثال: داخلی ۲۱۸ با پیش‌شماره‌ی 02144 می‌شود 02144218
    DIRECT_PREFIX: str = "02144"

    # سرویسِ سازگار با OpenAI برای تکمیلِ فیلدهای توصیفیِ پرسنل.
    # بدونِ کلید، دکمه‌ی تکمیل خطای روشن می‌دهد و بقیه‌ی برنامه کار می‌کند.
    AI_BASE_URL: str = "https://api.openai.com/v1"
    AI_API_KEY: str = ""
    AI_MODEL: str = "gpt-4o-mini"

    ADMIN_USERNAME: str = "admin"
    ADMIN_PASSWORD: str = "admin123"
    HEAD_OFFICE_NAME: str = "دفتر مرکزی"
    HEAD_OFFICE_CODE: str = "HEAD"

settings = Settings()


def validate_production_settings() -> None:
    if settings.ENVIRONMENT.lower() != "production":
        return
    if settings.SECRET_KEY == "change-me-in-production" or len(settings.SECRET_KEY) < 32:
        raise RuntimeError("SECRET_KEY must be a unique value of at least 32 characters in production")
    if settings.ADMIN_PASSWORD in {"admin123", "change-me"} or len(settings.ADMIN_PASSWORD) < 10:
        raise RuntimeError("ADMIN_PASSWORD must be changed before production startup")
