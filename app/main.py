from __future__ import annotations

import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from app import auth, db
from app.routers import actions, auth as auth_router, settings, sources
from app.scheduler import shutdown_scheduler, start_scheduler

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
log = logging.getLogger("appupdate")

WEB_DIR = Path(__file__).resolve().parent.parent / "web"

PUBLIC_API_PREFIXES = (
    "/api/health",
    "/api/auth/status",
    "/api/auth/login",
)


@asynccontextmanager
async def lifespan(_: FastAPI):
    db.init_db()
    start_scheduler()
    log.info("AppUpdate ready")
    yield
    shutdown_scheduler()


app = FastAPI(title="更新追踪", lifespan=lifespan)


@app.middleware("http")
async def panel_auth_middleware(request: Request, call_next):
    path = request.url.path
    if path.startswith("/api/") and not any(path == p or path.startswith(p + "/") for p in PUBLIC_API_PREFIXES):
        # exact match for public paths
        if path not in PUBLIC_API_PREFIXES:
            if auth.is_password_required():
                token = auth.extract_bearer(request.headers.get("authorization"))
                if not token:
                    token = request.cookies.get("appupdate_token")
                if not auth.validate_session(token):
                    return JSONResponse({"detail": "未登录或登录已失效"}, status_code=401)
    return await call_next(request)


app.include_router(auth_router.router)
app.include_router(sources.router)
app.include_router(settings.router)
app.include_router(actions.router)


@app.get("/api/health")
def health():
    return {"ok": True}



if WEB_DIR.exists():
    app.mount("/static", StaticFiles(directory=WEB_DIR), name="static")

    @app.get("/")
    def index():
        return FileResponse(WEB_DIR / "index.html")

    @app.get("/favicon.ico")
    def favicon():
        return FileResponse(WEB_DIR / "favicon.ico")
