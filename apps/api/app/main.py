from __future__ import annotations

from contextlib import asynccontextmanager
from pathlib import Path

from alembic import command
from alembic.config import Config
from fastapi import FastAPI
from starlette.middleware.sessions import SessionMiddleware

from . import config, security, seed
from .db import SessionLocal
from .routers import analytics, auth, data, public


def run_migrations() -> None:
    root = Path(__file__).resolve().parent.parent
    cfg = Config(str(root / "alembic.ini"))
    cfg.set_main_option("script_location", str(root / "alembic"))
    command.upgrade(cfg, "head")


@asynccontextmanager
async def lifespan(app: FastAPI):
    if config.IS_PROD and (config.SECRET_KEY.startswith("dev-only") or security.using_default_password()):
        raise RuntimeError("APP_ENV=production nhưng SECRET_KEY hoặc mật khẩu admin vẫn là giá trị mặc định. "
                           "Đặt SECRET_KEY và ADMIN_PASSWORD (hoặc ADMIN_PASSWORD_HASH).")
    run_migrations()
    if config.SEED_DEMO:
        with SessionLocal() as db:
            seed.seed_demo(db)
    yield


app = FastAPI(title="SnackStream Analytics API", lifespan=lifespan, docs_url="/api/docs", openapi_url="/api/openapi.json")
app.add_middleware(SessionMiddleware, secret_key=config.SECRET_KEY, same_site="lax", max_age=60 * 60 * 12, https_only=config.IS_PROD)
for r in (auth.router, analytics.router, data.router, public.router):
    app.include_router(r)


@app.get("/healthz")
@app.get("/api/healthz")
def healthz():
    return {"ok": True}
