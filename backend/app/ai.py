"""تکمیلِ فیلدهای توصیفیِ پرسنل با یک مدلِ زبانیِ سازگار با OpenAI."""
import json

import httpx
from fastapi import HTTPException

from .core.config import settings

# فیلدهایی که مدل می‌سازد — دقیقاً همان‌هایی که در فرم جدا افتاده‌اند.
GENERATED = ("keywords", "skills", "languages", "notes")

# فیلدهایی که به مدل داده می‌شوند. شماره‌ها و ایمیل عمداً نمی‌روند:
# نه به کار مدل می‌آیند و نه دلیلی دارد از سازمان بیرون بروند.
CONTEXT = (
    "first_name", "last_name", "latin_name",
    "department", "company", "job_title", "location", "working_hours",
)

SYSTEM = """تو دستیارِ یک دفترچه‌تلفنِ سازمانی فارسی هستی.
از روی مشخصاتِ داده‌شده‌ی یک کارمند، این چهار فیلد را حدس بزن:

keywords: کلیدواژه‌ها و نام‌های مستعاری که همکاران ممکن است با آن دنبالش بگردند، با «؛» جدا شده.
skills: مهارت‌ها و حوزه‌ی کاری، با «؛» جدا شده.
languages: زبان‌هایی که احتمالاً کاری‌اند، با «؛» جدا شده. اگر نشانه‌ای نیست، «فارسی».
notes: یک یادداشتِ کوتاهِ یک‌خطی درباره‌ی اینکه برای چه کاری سراغ این نفر می‌روند.

قواعد:
- فقط فارسی بنویس، مگر اصطلاحِ فنی که فارسیِ رایج ندارد.
- چیزی از خودت درنیاور که از مشخصات درنمی‌آید؛ فیلدی که پایه‌ای ندارد را خالی بگذار.
- فقط و فقط یک شیٔ JSON با همین چهار کلید برگردان، بدون هیچ توضیحِ اضافه."""


def suggest_fields(profile: dict) -> dict:
    """چهار فیلدِ توصیفی را از روی بقیه‌ی فیلدها می‌سازد."""
    if not settings.AI_API_KEY:
        raise HTTPException(503, "کلید سرویس هوش مصنوعی تنظیم نشده است (AI_API_KEY در .env)")

    known = "\n".join(f"{k}: {profile[k]}" for k in CONTEXT if (profile.get(k) or "").strip())
    if not known:
        raise HTTPException(400, "اول چند فیلد مثل نام و سمت را پر کنید")

    try:
        res = httpx.post(
            f"{settings.AI_BASE_URL.rstrip('/')}/chat/completions",
            headers={"Authorization": f"Bearer {settings.AI_API_KEY}"},
            # temperature فرستاده نمی‌شود: مدل‌های تازه فقط مقدارِ پیش‌فرض را
            # می‌پذیرند و با هر مقدارِ دیگری ۴۰۰ می‌دهند. پیش‌فرض همه‌جا کار می‌کند.
            json={
                "model": settings.AI_MODEL,
                "messages": [
                    {"role": "system", "content": SYSTEM},
                    {"role": "user", "content": known},
                ],
            },
            timeout=45,
        )
        res.raise_for_status()
        content = res.json()["choices"][0]["message"]["content"]
    except httpx.TransportError as exc:
        # اتصال اصلاً برقرار نشد — آدرس غلط است یا شبکه راهش نمی‌دهد.
        raise HTTPException(
            502,
            f"به سرویس هوش مصنوعی نمی‌رسیم ({settings.AI_BASE_URL}). "
            "آدرس AI_BASE_URL یا دسترسی شبکه‌ی سرور را بررسی کنید.",
        ) from exc
    except httpx.HTTPStatusError as exc:
        # دلیلِ واقعی در بدنه‌ی پاسخ است (مدلِ ناموجود، کلیدِ باطل، سهمیه‌ی
        # تمام‌شده). بدونِ آن ادمین فقط یک عددِ بی‌معنی می‌بیند.
        raise HTTPException(
            502, f"سرویس هوش مصنوعی خطا داد ({exc.response.status_code}): {_upstream(exc.response)}"
        ) from exc
    except httpx.HTTPError as exc:
        raise HTTPException(502, f"سرویس هوش مصنوعی پاسخ نداد: {exc}") from exc
    except (KeyError, IndexError, ValueError) as exc:
        raise HTTPException(502, "پاسخ سرویس هوش مصنوعی قابل خواندن نبود") from exc

    return _parse(content)


def _upstream(res: httpx.Response) -> str:
    """پیامِ خطای سرویسِ بالادست — هرچه داد، وگرنه خودِ متنِ پاسخ."""
    try:
        return str(res.json()["error"]["message"])[:300]
    except Exception:
        return (res.text or "بدون توضیح")[:300]


def _parse(content: str) -> dict:
    """JSON را از پاسخ بیرون می‌کشد — بعضی مدل‌ها آن را در ``` می‌پیچند."""
    text = content.strip()
    start, end = text.find("{"), text.rfind("}")
    if start == -1 or end <= start:
        raise HTTPException(502, "پاسخ سرویس هوش مصنوعی قابل خواندن نبود")
    try:
        data = json.loads(text[start : end + 1])
    except json.JSONDecodeError as exc:
        raise HTTPException(502, "پاسخ سرویس هوش مصنوعی قابل خواندن نبود") from exc
    return {k: str(data.get(k) or "").strip() for k in GENERATED}
