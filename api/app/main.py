from __future__ import annotations

import asyncio
import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path

from alembic.config import Config
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from sqlalchemy.orm import Session
from starlette.middleware.sessions import SessionMiddleware

from alembic import command
from app import models  # noqa: F401  (registers tables)
from app.core.config import Settings, get_settings
from app.core.db import make_engine, make_session_factory
from app.core.errors import install_error_handlers
from app.core.logging import RequestIdMiddleware, configure_logging
from app.core.storage import LocalMediaStorage, build_storage
from app.modules.analytics import router_admin as analytics_admin
from app.modules.analytics import router_public as analytics_public
from app.modules.auth import router as auth_router
from app.modules.auth import service as auth_service
from app.modules.catalog import router_admin as catalog_admin
from app.modules.catalog import router_public as catalog_public
from app.modules.catalog import seed as catalog_seed
from app.modules.chat import router as chat_router
from app.modules.customers import router as customers_router
from app.modules.customers import router_admin as customers_admin
from app.modules.health import router as health_router
from app.modules.inventory import router_admin as inventory_admin
from app.modules.live import router as live_router
from app.modules.live.runtime import run_playback
from app.modules.live.service import LiveService
from app.modules.orders import router_admin as orders_admin
from app.modules.orders import router_public as orders_public
from app.modules.rag import index as rag_index
from app.modules.rag.embedder import make_embedder

log = logging.getLogger(__name__)
API_ROOT = Path(__file__).resolve().parent.parent


def run_migrations(database_url: str) -> None:
    cfg = Config(str(API_ROOT / "alembic.ini"))
    cfg.set_main_option("script_location", str(API_ROOT / "alembic"))
    cfg.set_main_option("sqlalchemy.url", database_url.replace("%", "%%"))
    command.upgrade(cfg, "head")


def _index_knowledge(db: Session, settings: Settings) -> None:
    """Build the chatbot's searchable passages at start-up. Cheap when nothing changed (only new or edited text is embedded),
    and a failure here must never stop the API: the chatbot just answers from what it has."""
    try:
        stats = rag_index.reindex(db, make_embedder(settings))
        log.info("knowledge index ready: %s", stats)
    except Exception:
        log.exception("knowledge index could not be built; the chatbot may find no passages")


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or get_settings()
    configure_logging()

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        if settings.run_migrations_on_start:
            run_migrations(settings.database_url)
        with app.state.session_factory() as db:
            auth_service.ensure_bootstrap_admin(db, settings)
            if settings.seed_demo_catalog:
                catalog_seed.seed_catalog(db, app.state.storage)
            if settings.chat_rag_enabled:
                _index_knowledge(db, settings)
        playback_task = None
        if settings.live_mock_enabled or settings.live_make_enabled or settings.live_simli_enabled:
            playback_task = asyncio.create_task(run_playback(app.state.live, settings))
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
    app.state.storage = build_storage(settings)
    if isinstance(app.state.storage, LocalMediaStorage):
        app.mount("/api/media", StaticFiles(directory=app.state.storage.root), name="media")

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
        customers_router.router,
        customers_admin.router,
        catalog_public.router,
        catalog_admin.router,
        orders_public.router,
        orders_admin.router,
        inventory_admin.router,
        analytics_admin.router,
        analytics_public.router,
        live_router.router,
        live_router.admin_router,
    ):
        app.include_router(router)
    app.include_router(chat_router.router)
    app.include_router(chat_router.admin_router)
    return app


app = create_app()
