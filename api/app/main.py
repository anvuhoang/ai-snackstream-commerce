from __future__ import annotations
import asyncio

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path

from alembic.config import Config
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.sessions import SessionMiddleware

from alembic import command
from app import models  # noqa: F401  (registers tables)
from app.core.config import Settings, get_settings
from app.core.db import make_engine, make_session_factory
from app.core.errors import install_error_handlers
from app.core.logging import RequestIdMiddleware, configure_logging
from app.modules.auth import router as auth_router
from app.modules.auth import service as auth_service
from app.modules.health import router as health_router
from app.modules.live import router as live_router
from app.modules.live.service import LiveService
from app.modules.live.runtime import run_mock_playback

API_ROOT = Path(__file__).resolve().parent.parent


def run_migrations(database_url: str) -> None:
    cfg = Config(str(API_ROOT / "alembic.ini"))
    cfg.set_main_option("script_location", str(API_ROOT / "alembic"))
    cfg.set_main_option("sqlalchemy.url", database_url.replace("%", "%%"))
    command.upgrade(cfg, "head")


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or get_settings()
    configure_logging()

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        if settings.run_migrations_on_start:
            run_migrations(settings.database_url)
        with app.state.session_factory() as db:
            auth_service.ensure_bootstrap_admin(db, settings)
        playback_task = None
        if settings.live_mock_enabled:
            playback_task = asyncio.create_task(run_mock_playback(app.state.live, settings))
        try:
            yield
        finally:
            if playback_task is not None:
                playback_task.cancel()
                await asyncio.gather(playback_task, return_exceptions=True)
            app.state.engine.dispose()

    app = FastAPI(
        title="SnackStream API",
        version="0.1.0",
        lifespan=lifespan,
        docs_url="/api/docs",
        openapi_url="/api/openapi.json",
        redoc_url=None,
    )
    app.state.settings = settings
    app.state.engine = make_engine(settings.database_url)
    app.state.session_factory = make_session_factory(app.state.engine)
    app.state.live = LiveService()

    # Middleware order: the last one added runs first.
    app.add_middleware(
        SessionMiddleware,
        secret_key=settings.secret_key,
        session_cookie="ss_admin",
        same_site="lax",
        https_only=settings.is_prod,
        max_age=settings.session_max_age,
    )
    if settings.cors_origins:
        app.add_middleware(
            CORSMiddleware,
            allow_origins=settings.cors_origins,
            allow_credentials=True,
            allow_methods=["*"],
            allow_headers=["*"],
        )
    app.add_middleware(RequestIdMiddleware)

    install_error_handlers(app)
    for router in (
        health_router.router,
        auth_router.router,
        live_router.router,
        live_router.admin_router,
    ):
        app.include_router(router)
    return app


app = create_app()
