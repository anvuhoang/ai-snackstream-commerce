import pytest
from pydantic import ValidationError

from app.core.config import DEV_SECRET, Settings, normalize_db_url


def test_liveness_and_readiness(client):
    assert client.get("/api/healthz").json() == {"ok": True}
    assert client.get("/api/readyz").json() == {"ok": True, "database": "up"}


def test_request_id_is_echoed_and_generated(client):
    assert client.get("/api/healthz", headers={"X-Request-ID": "abc123"}).headers["x-request-id"] == "abc123"
    assert client.get("/api/healthz").headers["x-request-id"]


@pytest.mark.parametrize(
    "given,expected",
    [
        ("postgres://u:p@h:5432/d", "postgresql+psycopg://u:p@h:5432/d"),
        ("postgresql://u:p@h/d", "postgresql+psycopg://u:p@h/d"),
        ("postgresql+psycopg://u:p@h/d", "postgresql+psycopg://u:p@h/d"),
        ("sqlite:///x.db", "sqlite:///x.db"),
    ],
)
def test_database_url_is_normalized(given, expected):
    assert normalize_db_url(given) == expected


def test_production_refuses_the_default_secret():
    with pytest.raises(ValidationError):
        Settings(APP_ENV="production", SECRET_KEY=DEV_SECRET)
    assert Settings(APP_ENV="production", SECRET_KEY="x" * 40).run_migrations_on_start is False


def test_dev_runs_migrations_on_start_by_default():
    assert Settings(APP_ENV="dev").run_migrations_on_start is True
