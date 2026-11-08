"""Copying on-hand counts from Odoo. Odoo is faked with httpx.MockTransport: no network, no real key."""

from __future__ import annotations

import httpx
import pytest

from app.core.config import Settings
from app.core.errors import AppError
from app.modules.inventory import sync
from app.modules.inventory.odoo import OdooClient

from .test_inventory import INVENTORY, add, order_id, place, row, sellable, status, track


def odoo_settings(settings: Settings) -> Settings:
    return settings.model_copy(
        update={"odoo_url": "https://odoo.test", "odoo_db": "shop", "odoo_api_key": "test-key"}
    )


def fake_odoo(products: list[dict] | None = None, code: int = 200) -> httpx.MockTransport:
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(code, json=products or [])

    transport = httpx.MockTransport(handler)
    transport.seen = seen  # type: ignore[attr-defined]
    return transport


def odoo_row(sku: str, qty: float) -> dict:
    return {"default_code": sku, "name": sku, "qty_available": qty, "list_price": 1000.0}


def run_sync(client, settings: Settings, transport: httpx.MockTransport):
    cfg = odoo_settings(settings)
    with client.app.state.session_factory() as db:
        return sync.sync_from_odoo(db, cfg, OdooClient(cfg, transport))


def test_a_sync_copies_odoo_counts_by_sku_and_logs_it(signed_in, settings):
    a, b = sellable(signed_in), sellable(signed_in)
    transport = fake_odoo([odoo_row(a["variants"][0]["sku"], 40), odoo_row("NOT-OURS", 9)])
    run = run_sync(signed_in, settings, transport)
    assert (run.ok, run.matched, run.changed) == (True, 1, 1)
    assert b["variants"][0]["sku"] in run.missing_skus  # ours, unknown to Odoo
    r = row(signed_in, a["variants"][0]["id"])
    assert (r["onHand"], r["source"], r["tracked"]) == (40, "odoo", True)
    assert row(signed_in, b["variants"][0]["id"])["tracked"] is False  # untouched
    log = signed_in.get(f"{INVENTORY}/{a['variants'][0]['id']}/movements").json()
    assert log[0]["kind"] == "sync" and log[0]["deltaOnHand"] == 40


def test_the_request_asks_odoo_for_our_skus_with_the_key_and_database(signed_in, settings):
    p = sellable(signed_in)
    transport = fake_odoo([odoo_row(p["variants"][0]["sku"], 5)])
    run_sync(signed_in, settings, transport)
    req = transport.seen[0]  # type: ignore[attr-defined]
    assert req.url.path == "/json/2/product.product/search_read"
    assert req.headers["authorization"] == "bearer test-key" and req.headers["x-odoo-database"] == "shop"


def test_a_second_sync_with_the_same_numbers_changes_nothing(signed_in, settings):
    p = sellable(signed_in)
    transport = fake_odoo([odoo_row(p["variants"][0]["sku"], 12.0)])
    assert run_sync(signed_in, settings, transport).changed == 1
    again = run_sync(signed_in, settings, transport)
    assert (again.ok, again.matched, again.changed) == (True, 1, 0)


def test_odoo_never_sets_a_count_below_what_open_orders_hold(signed_in, anon, settings):
    p = sellable(signed_in)
    vid = track(signed_in, p, 10)
    add(anon, p, 6)
    assert place(anon).status_code == 201  # 6 reserved
    # Odoo says 2, but 6 are promised: the count may not go under 6, or the order could not be shipped.
    run_sync(signed_in, settings, fake_odoo([odoo_row(p["variants"][0]["sku"], 2)]))
    r = row(signed_in, vid)
    assert (r["onHand"], r["reserved"], r["available"]) == (6, 6, 0)


def test_when_odoo_owns_the_count_shipping_does_not_lower_it_twice(signed_in, anon, settings):
    p = sellable(signed_in)
    vid = p["variants"][0]["id"]
    run_sync(signed_in, settings, fake_odoo([odoo_row(p["variants"][0]["sku"], 20)]))
    add(anon, p, 4)
    assert place(anon).status_code == 201
    oid = order_id(signed_in)
    assert status(signed_in, oid, "confirmed").status_code == 200
    assert status(signed_in, oid, "shipping").status_code == 200
    r = row(signed_in, vid)
    assert (r["onHand"], r["reserved"]) == (20, 0)  # the reservation ends; Odoo's own delivery lowers on_hand


def test_a_count_that_comes_from_odoo_cannot_be_edited_here(signed_in, settings):
    p = sellable(signed_in)
    run_sync(signed_in, settings, fake_odoo([odoo_row(p["variants"][0]["sku"], 20)]))
    r = signed_in.post(f"{INVENTORY}/{p['variants'][0]['id']}/adjust", json={"kind": "receive", "delta": 1})
    assert r.status_code == 409 and r.json()["error"]["code"] == "managed_by_odoo"


@pytest.mark.parametrize(
    ("code", "words"),
    [(401, "refused"), (403, "refused"), (404, "ODOO_URL"), (500, "HTTP 500")],
)
def test_a_failed_sync_is_recorded_and_changes_no_number(signed_in, settings, code, words):
    p = sellable(signed_in)
    vid = track(signed_in, p, 7)
    run = run_sync(signed_in, settings, fake_odoo(code=code))
    assert run.ok is False and words in run.error and run.matched == 0
    assert row(signed_in, vid)["onHand"] == 7
    assert "test-key" not in run.error  # the key never leaks into what the back office shows


def test_an_unreachable_odoo_is_a_recorded_failure_not_a_crash(signed_in, settings):
    sellable(signed_in)  # with no variants there is nothing to ask Odoo about

    def boom(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("no route")

    run = run_sync(signed_in, settings, httpx.MockTransport(boom))
    assert run.ok is False and "Cannot reach Odoo" in run.error


def test_sync_refuses_to_start_when_odoo_is_not_configured(client, settings):
    with client.app.state.session_factory() as db, pytest.raises(AppError) as exc:
        sync.sync_from_odoo(db, settings)
    assert exc.value.code == "odoo_not_configured"


def test_the_status_endpoint_reports_whether_odoo_is_on_and_the_last_run(signed_in, anon):
    first = signed_in.get(f"{INVENTORY}/sync").json()
    assert first == {"enabled": False, "lastRun": None}
    assert signed_in.post(f"{INVENTORY}/sync").status_code == 409
    assert anon.get(f"{INVENTORY}/sync").status_code == 401
