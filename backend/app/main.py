"""Caspian Number — FastAPI application entrypoint."""
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .bootstrap import ensure_admin
from .core.config import settings
from .models import SessionLocal, init_db
from .routers import admin, auth, employees

app = FastAPI(title="Caspian Number", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # same-origin in production (nginx); open for dev
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router)
app.include_router(employees.router)
app.include_router(admin.router)


@app.on_event("startup")
def startup():
    init_db()
    db = SessionLocal()
    try:
        ensure_admin(db)
    finally:
        db.close()


@app.get("/api/health")
def health():
    # پیش‌شماره را فرانت هم لازم دارد تا در پنل مدیریت پیش‌نمایشِ
    # شماره‌ی مستقیم را نشان بدهد — بدون کپیِ دستیِ همان عدد.
    return {
        "status": "ok",
        "app": settings.APP_NAME,
        "direct_prefix": settings.DIRECT_PREFIX,
    }


# ---- Serve the built React app (single-container deploy / local test) ----
import os

from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

FRONTEND_DIST = os.path.abspath(
    os.environ.get("FRONTEND_DIST", os.path.join(os.path.dirname(__file__), "../../frontend/dist"))
)

if os.path.isdir(FRONTEND_DIST):
    _assets_dir = os.path.join(FRONTEND_DIST, "assets")
    if os.path.isdir(_assets_dir):
        app.mount("/assets", StaticFiles(directory=_assets_dir), name="assets")

    @app.get("/{full_path:path}", include_in_schema=False)
    def spa_fallback(full_path: str):
        candidate = os.path.join(FRONTEND_DIST, full_path)
        if full_path and os.path.isfile(candidate):
            return FileResponse(candidate)
        return FileResponse(os.path.join(FRONTEND_DIST, "index.html"))
