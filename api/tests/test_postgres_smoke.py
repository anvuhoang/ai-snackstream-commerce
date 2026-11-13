"""Runs only when POSTGRES_TEST_URL points at a throw-away database (CI does this). Proves the migrations and the catalog
queries work on PostgreSQL, not just on the SQLite used for the fast run."""

import os

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text

from app.core.config import Settings
from app.main import create_app
from app.modules.catalog import seed

pytestmark = pytest.mark.postgres


@pytest.fixture()
def pg_client(tmp_path):
    url = os.environ["POSTGRES_TEST_URL"]
    engine = create_engine(Settings(DATABASE_URL=url).database_url)
    with engine.begin() as conn:  # start from an empty schema every time
        conn.execute(text("DROP SCHEMA public CASCADE"))
        conn.execute(text("CREATE SCHEMA public"))
    engine.dispose()
    settings = Settings(
        APP_ENV="test", DATABASE_URL=url, SECRET_KEY="t", MEDIA_DIR=str(tmp_path), SEED_DEMO_CATALOG=True
    )
    with TestClient(create_app(settings)) as client:
        yield client


def test_catalog_works_on_postgres(pg_client):
    page = pg_client.get("/api/catalog/products", params={"pageSize": 48}).json()
    assert page["total"] == len(seed.PRODUCTS)
    found = pg_client.get("/api/catalog/products", params={"q": "banh trang"}).json()
    assert found["total"] >= 1
    assert pg_client.get("/api/catalog/products", params={"sort": "price_asc"}).status_code == 200
    assert pg_client.get("/api/catalog/products", params={"q": "%"}).json()["total"] == 0
