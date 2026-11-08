from __future__ import annotations

import os
from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient

from app.core.config import Settings
from app.main import create_app
from app.modules.auth import router as auth_router
from app.modules.auth import service as auth_service
from app.modules.orders import router_public as orders_public

ADMIN_EMAIL = "admin@example.com"
ADMIN_PASSWORD = "correct-horse-battery"
STAFF_EMAIL = "staff@example.com"
STAFF_PASSWORD = "staff-horse-battery"


def pytest_collection_modifyitems(config, items):
    """Tests marked `postgres` need a real PostgreSQL; they only run when POSTGRES_TEST_URL is set (CI sets it)."""
    if os.environ.get("POSTGRES_TEST_URL"):
        return
    skip = pytest.mark.skip(reason="set POSTGRES_TEST_URL to run PostgreSQL tests")
    for item in items:
        if "postgres" in item.keywords:
            item.add_marker(skip)


@pytest.fixture()
def settings(tmp_path) -> Settings:
    # SQLite keeps unit tests dependency-free. Anything that relies on PostgreSQL features (row locks,
    # concurrency) is marked `@pytest.mark.postgres` and runs against POSTGRES_TEST_URL in CI.
    return Settings(
        APP_ENV="test",
        DATABASE_URL=f"sqlite:///{(tmp_path / 'test.db').as_posix()}",
        SECRET_KEY="test-secret",
        MEDIA_DIR=str(tmp_path / "media"),
        BOOTSTRAP_ADMIN_EMAIL=ADMIN_EMAIL,
        BOOTSTRAP_ADMIN_PASSWORD=ADMIN_PASSWORD,
    )


@pytest.fixture()
def client(settings: Settings) -> Iterator[TestClient]:
    auth_router._login_limiter._hits.clear()
    orders_public._lookup_limiter._hits.clear()
    # Entering the context runs the lifespan: migrations + bootstrap admin.
    with TestClient(create_app(settings)) as c:
        yield c


@pytest.fixture()
def signed_in(client: TestClient) -> TestClient:
    """The shared client, signed in as admin (carries the CSRF header for writes)."""
    r = client.post("/api/admin/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD})
    assert r.status_code == 200
    client.headers["X-CSRF-Token"] = r.json()["csrf"]
    return client


@pytest.fixture()
def anon(client: TestClient) -> TestClient:
    """A visitor: same app, no cookies, no CSRF header."""
    return TestClient(client.app)


@pytest.fixture()
def staff(client: TestClient) -> TestClient:
    """A signed-in staff user (may read the back office, may not change the catalog)."""
    with client.app.state.session_factory() as db:
        auth_service.create_admin(db, STAFF_EMAIL, STAFF_PASSWORD, "staff")
    c = TestClient(client.app)
    r = c.post("/api/admin/auth/login", json={"email": STAFF_EMAIL, "password": STAFF_PASSWORD})
    assert r.status_code == 200
    c.headers["X-CSRF-Token"] = r.json()["csrf"]
    return c
