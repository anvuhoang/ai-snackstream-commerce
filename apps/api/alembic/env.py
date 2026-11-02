from logging.config import fileConfig

from alembic import context
from sqlalchemy import create_engine, pool

from app import config as app_config
from app import models  # noqa: F401  (registers the tables on the metadata)
from app.db import Base

cfg = context.config
if cfg.config_file_name is not None and not cfg.attributes.get("skip_logging"):
    fileConfig(cfg.config_file_name, disable_existing_loggers=False)

target_metadata = Base.metadata
URL = app_config.DATABASE_URL


def run_migrations_offline() -> None:
    context.configure(url=URL, target_metadata=target_metadata, literal_binds=True, dialect_opts={"paramstyle": "named"},
                      render_as_batch=URL.startswith("sqlite"))
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    connect_args = {"check_same_thread": False} if URL.startswith("sqlite") else {}
    engine = create_engine(URL, poolclass=pool.NullPool, connect_args=connect_args)
    with engine.connect() as connection:
        context.configure(connection=connection, target_metadata=target_metadata, render_as_batch=URL.startswith("sqlite"))
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
