from __future__ import annotations

from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient

from app.core.config import Settings
from app.main import create_app
from app.modules.auth import router as auth_router

ADMIN_EMAIL = "admin@example.com"
ADMIN_PASSWORD = "correct-horse-battery"


@pytest.fixture()
def settings(tmp_path) -> Settings:
    # SQLite keeps unit tests dependency-free. Anything that relies on PostgreSQL features (row locks,
    # full-text search) must be marked `@pytest.mark.postgres` and runs against DATABASE_URL in CI.
    return Settings(
        _env_file=None,
        APP_ENV="test",
        DATABASE_URL=f"sqlite:///{(tmp_path / 'test.db').as_posix()}",
        SECRET_KEY="test-secret",
        BOOTSTRAP_ADMIN_EMAIL=ADMIN_EMAIL,
        BOOTSTRAP_ADMIN_PASSWORD=ADMIN_PASSWORD,
        LIVE_MOCK_ENABLED=False,
        LIVE_MAKE_ENABLED=False,
        LIVE_MAKE_WEBHOOK_URL="",
        LIVE_MAKE_CALLBACK_TOKEN="",
    )


@pytest.fixture()
def client(settings: Settings) -> Iterator[TestClient]:
    auth_router._login_limiter._hits.clear()
    with TestClient(
        create_app(settings)
    ) as c:  # entering the context runs the lifespan (migrations + bootstrap admin)
        yield c


@pytest.fixture()
def signed_in(client: TestClient) -> TestClient:
    r = client.post("/api/admin/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD})
    assert r.status_code == 200
    client.headers["X-CSRF-Token"] = r.json()["csrf"]
    return client
