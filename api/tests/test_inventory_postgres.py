"""Runs only when POSTGRES_TEST_URL points at a THROW-AWAY database (the fixture empties its public schema, like the smoke test).

SQLite runs one writer at a time, so it cannot show the race this feature exists for: two customers pressing "place order" on
the last unit at the same instant. PostgreSQL really runs the two requests in parallel, and the single conditional UPDATE in
`inventory.reserve` is what must let exactly one of them win.

    POSTGRES_TEST_URL=postgresql+psycopg://user:pass@localhost:5432/snackstream_test uv run pytest tests/test_inventory_postgres.py
"""

from __future__ import annotations

import os
import threading
from concurrent.futures import ThreadPoolExecutor

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text

from app.core.config import Settings
from app.main import create_app

from .test_inventory import INVENTORY, row, track
from .test_orders import ADMIN_ORDERS, CART, body, key, sellable

pytestmark = pytest.mark.postgres

ADMIN = ("race-admin@example.com", "race-password-123")


@pytest.fixture()
def pg_admin(tmp_path):
    url = os.environ["POSTGRES_TEST_URL"]
    engine = create_engine(Settings(DATABASE_URL=url).database_url)
    with engine.begin() as conn:
        conn.execute(text("DROP SCHEMA public CASCADE"))
        conn.execute(text("CREATE SCHEMA public"))
    engine.dispose()
    settings = Settings(
        APP_ENV="test",
        DATABASE_URL=url,
        SECRET_KEY="t",
        MEDIA_DIR=str(tmp_path),
        BOOTSTRAP_ADMIN_EMAIL=ADMIN[0],
        BOOTSTRAP_ADMIN_PASSWORD=ADMIN[1],
        VNPAY_TMN_CODE="",
        VNPAY_HASH_SECRET="",
        ODOO_URL="",
        ODOO_DB="",
        ODOO_API_KEY="",
    )
    with TestClient(create_app(settings)) as client:
        r = client.post("/api/admin/auth/login", json={"email": ADMIN[0], "password": ADMIN[1]})
        assert r.status_code == 200, r.text
        client.headers["X-CSRF-Token"] = r.json()["csrf"]
        yield client


def _buyer(app, product: dict, gate: threading.Barrier) -> int:
    """One customer: fills a cart, waits for the other customer, then places the order. Returns the HTTP status."""
    c = TestClient(app)
    added = c.post(f"{CART}/items", json={"variantId": product["variants"][0]["id"], "qty": 1})
    assert added.status_code == 200, added.text
    gate.wait(timeout=30)  # both carts are ready: release both orders at the same moment
    return c.post("/api/orders", json=body(), headers={"Idempotency-Key": key()}).status_code


def test_two_customers_racing_for_the_last_unit_one_wins(pg_admin):
    p = sellable(pg_admin)
    vid = track(pg_admin, p, 1)
    gate = threading.Barrier(2)
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = sorted(f.result() for f in [pool.submit(_buyer, pg_admin.app, p, gate) for _ in range(2)])
    assert results == [201, 409], results  # exactly one order, one refusal
    assert pg_admin.get(ADMIN_ORDERS).json()["total"] == 1
    r = row(pg_admin, vid)
    assert (r["onHand"], r["reserved"], r["available"]) == (1, 1, 0)  # never oversold, never negative


def test_many_customers_never_oversell_a_small_stock(pg_admin):
    p = sellable(pg_admin)
    vid = track(pg_admin, p, 3)
    buyers = 8
    gate = threading.Barrier(buyers)
    with ThreadPoolExecutor(max_workers=buyers) as pool:
        results = [f.result() for f in [pool.submit(_buyer, pg_admin.app, p, gate) for _ in range(buyers)]]
    assert results.count(201) == 3 and results.count(409) == buyers - 3, results
    r = row(pg_admin, vid)
    assert (r["onHand"], r["reserved"], r["available"]) == (3, 3, 0)
    assert pg_admin.get(INVENTORY, params={"pageSize": 100}).status_code == 200
