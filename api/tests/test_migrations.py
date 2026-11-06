"""Guards against the most common team mistake: changing a model without adding a migration."""

from alembic.autogenerate import compare_metadata
from alembic.migration import MigrationContext
from sqlalchemy import create_engine, inspect

from app import models  # noqa: F401
from app.core.db import Base
from app.main import run_migrations


def test_migrations_build_exactly_what_the_models_describe(tmp_path):
    url = f"sqlite:///{(tmp_path / 'mig.db').as_posix()}"
    run_migrations(url)
    engine = create_engine(url)
    assert set(Base.metadata.tables) <= set(inspect(engine).get_table_names())
    with engine.connect() as conn:
        diff = compare_metadata(MigrationContext.configure(conn, opts={"compare_type": True}), Base.metadata)
    assert diff == [], f"models and migrations have drifted — add a migration: {diff}"
