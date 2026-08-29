"""Application configuration via environment variables."""
from pathlib import Path

from pydantic_settings import BaseSettings

# CaspianNumber/ project root (config.py -> core -> app -> backend -> root)
BASE_DIR = Path(__file__).resolve().parents[3]
_DEFAULT_DB = f"sqlite:///{BASE_DIR / 'backend' / 'data' / 'caspian.db'}"


class Settings(BaseSettings):
    APP_NAME: str = "Caspian Number"
    SECRET_KEY: str = "change-me-in-production"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60 * 12

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

    class Config:
        # absolute path -> works no matter which directory you launch from
        env_file = str(BASE_DIR / ".env")


settings = Settings()
