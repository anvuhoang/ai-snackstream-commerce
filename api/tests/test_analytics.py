"""Event intake, attribution and the funnel numbers (every formula and every "cannot be computed" rule)."""

from __future__ import annotations

from datetime import UTC, date, datetime

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from app.modules.analytics import events, report
from app.modules.analytics import router_public as events_router
from app.modules.catalog.models import Product

from .test_inventory import order_id, status
from .test_orders import add, place, sellable

EVENTS = "/api/events"
OVERVIEW = "/api/admin/analytics/overview"


def sid(n: int) -> str:
    return f"session-{n:04d}"


def send(client: TestClient, event: str, n: int = 1, **fields):
    return client.post(EVENTS, json={"event": event, "sessionId": sid(n), **fields})


def funnel(admin: TestClient, **params) -> dict:
    r = admin.get(OVERVIEW, params=params)
    assert r.status_code == 200, r.text
    return r.json()


def steps(body: dict) -> dict:
    return {s["key"]: s for s in body["funnel"]}


@pytest.fixture(autouse=True)
def _fresh_limiter():
    events_router._limiter._hits.clear()


def mark_demo(client: TestClient, product_id: int) -> None:
    with client.app.state.session_factory() as db:
        db.get(Product, product_id).is_demo = True
        db.commit()


# ================================================================== intake
def test_a_visitor_can_send_a_valid_event(signed_in, anon):
    p = sellable(signed_in)
    r = send(anon, "product_view", 1, sku=p["variants"][0]["sku"])
    assert r.status_code == 204
    assert steps(funnel(signed_in))["product_view"]["count"] == 1


@pytest.mark.parametrize(
    "payload",
    [
        {"event": "order_created", "sessionId": "session-0001"},  # only the server may say an order happened
        {"event": "order_completed", "sessionId": "session-0001"},
        {"event": "product_view", "sessionId": "x"},  # session id too short
        {"event": "product_view", "sessionId": "bad id with spaces!"},
        {"event": "nonsense", "sessionId": "session-0001"},
        {"event": "add_to_cart", "sessionId": "session-0001", "qty": 0},
        {"event": "add_to_cart", "sessionId": "session-0001", "qty": 500},
    ],
)
def test_bad_events_are_refused(anon, payload):
    assert anon.post(EVENTS, json=payload).status_code == 422


def test_an_unknown_sku_is_refused(anon):
    r = send(anon, "product_view", 1, sku="NO-SUCH-SKU")
    assert r.status_code == 422 and r.json()["error"]["code"] == "invalid_sku"


def test_sending_the_same_event_id_twice_stores_it_once(signed_in, anon):
    for _ in range(3):
        assert send(anon, "product_view", 1, eventId="evt-abcdefgh").status_code == 204
    assert steps(funnel(signed_in))["product_view"]["count"] == 1


def test_intake_is_rate_limited_per_address(anon):
    codes = [send(anon, "product_view", 1).status_code for _ in range(121)]
    assert codes[:120] == [204] * 120 and codes[120] == 429


def test_the_product_decides_whether_an_event_is_demo_not_the_browser(signed_in, anon):
    p = sellable(signed_in)
    mark_demo(signed_in, p["id"])
    send(anon, "product_view", 1, sku=p["variants"][0]["sku"], isDemo=False)  # the browser claims "real"
    assert steps(funnel(signed_in))["product_view"]["count"] == 0  # demo is excluded by default
    assert steps(funnel(signed_in, demo="include"))["product_view"]["count"] == 1
    assert steps(funnel(signed_in, demo="only"))["product_view"]["count"] == 1


def test_an_event_without_a_product_follows_the_demo_state_of_its_session(signed_in, anon):
    demo, real = sellable(signed_in), sellable(signed_in)
    mark_demo(signed_in, demo["id"])
    send(anon, "product_view", 1, sku=demo["variants"][0]["sku"])
    send(anon, "checkout_started", 1, cartValueVnd=10_000)  # the browser did not say "demo"
    send(anon, "product_view", 2, sku=real["variants"][0]["sku"])
    send(anon, "checkout_started", 2, cartValueVnd=10_000)
    assert steps(funnel(signed_in))["checkout_started"]["count"] == 1  # only the real session
    assert steps(funnel(signed_in, demo="only"))["checkout_started"]["count"] == 1  # only the demo session


# ================================================================== the funnel
def test_an_empty_period_says_cannot_compute_instead_of_zero(signed_in):
    body = funnel(signed_in)
    s = steps(body)
    assert [x["count"] for x in body["funnel"]] == [0, 0, 0, 0, 0]
    assert s["product_view"]["rateNote"] == "first_step" and s["product_view"]["rate"] is None
    assert s["add_to_cart"]["rateNote"] == "previous_step_empty" and s["add_to_cart"]["rate"] is None
    assert all(not x["trackingGap"] for x in body["funnel"])  # nothing at all is not a gap
    t = body["totals"]
    assert t["averageOrderVnd"] is None and t["completionRate"] is None and t["revenueVnd"] == 0


def test_sessions_are_counted_once_and_rates_follow_the_previous_step(signed_in, anon):
    p = sellable(signed_in)
    sku = p["variants"][0]["sku"]
    for n in (1, 2, 3, 4):
        send(anon, "product_view", n, sku=sku)
    send(anon, "product_view", 1, sku=sku)  # the same session again: still one
    for n in (1, 2):
        send(anon, "add_to_cart", n, sku=sku, qty=1, surface="store")
    send(anon, "checkout_started", 1, cartValueVnd=55_000)
    s = steps(funnel(signed_in))
    assert [s[k]["count"] for k in ("product_view", "add_to_cart", "checkout_started")] == [4, 2, 1]
    assert s["add_to_cart"]["rate"] == 0.5 and s["checkout_started"]["rate"] == 0.5
    assert s["product_view"]["unit"] == "sessions" and s["order_created"]["unit"] == "orders"


def test_created_and_completed_are_separate_and_revenue_counts_completed_only(signed_in, anon):
    a, b = sellable(signed_in, 50_000), sellable(signed_in, 20_000)
    add(anon, a, 2)  # 100.000 + 30.000 shipping
    assert place(anon).status_code == 201
    other = TestClient(anon.app)
    add(other, b, 1)
    assert place(other).status_code == 201
    first = signed_in.get("/api/admin/orders").json()["items"]
    done = next(o for o in first if o["totalVnd"] == 130_000)
    for to in ("confirmed", "shipping", "completed"):
        assert status(signed_in, done["id"], to).status_code == 200
    body = funnel(signed_in)
    s = steps(body)
    assert (s["order_created"]["count"], s["order_completed"]["count"]) == (2, 1)
    assert s["order_completed"]["rate"] == 0.5
    t = body["totals"]
    assert (t["ordersCreated"], t["ordersCompleted"], t["revenueVnd"]) == (2, 1, 130_000)
    assert t["averageOrderVnd"] == 130_000 and t["completionRate"] == 0.5


def test_a_cancelled_order_is_created_but_never_completed_and_adds_no_revenue(signed_in, anon):
    add(anon, sellable(signed_in), 1)
    place(anon)
    assert status(signed_in, order_id(signed_in), "cancelled").status_code == 200
    t = funnel(signed_in)["totals"]
    assert (t["ordersCreated"], t["ordersCompleted"], t["revenueVnd"]) == (1, 0, 0)
    assert (
        t["completionRate"] == 0.0
    )  # something was created and none completed: a real 0%, not "cannot compute"


def test_missing_steps_are_labelled_not_bridged(signed_in, anon):
    add(anon, sellable(signed_in), 1)
    place(anon)  # an order exists but nobody sent a single page event
    body = funnel(signed_in)
    s = steps(body)
    assert s["order_created"]["count"] == 1
    assert [s[k]["trackingGap"] for k in ("product_view", "add_to_cart", "checkout_started")] == [True] * 3
    assert s["order_created"]["rate"] is None and s["order_created"]["rateNote"] == "previous_step_empty"


def test_the_same_order_event_is_never_written_twice(signed_in, anon, client):
    add(anon, sellable(signed_in), 1)
    place(anon)
    oid = order_id(signed_in)
    from app.modules.orders.models import Order

    with client.app.state.session_factory() as db:
        order = db.get(Order, oid)
        events.record_order_event(db, "order_created", order)  # a second call
        events.record_order_event(db, "order_created", order)
        db.commit()
    assert steps(funnel(signed_in))["order_created"]["count"] == 1


# ================================================================== attribution
def test_an_order_carries_the_last_touch_it_was_sent_with_and_it_is_tidied(signed_in, anon):
    p = sellable(signed_in)
    add(anon, p, 1)
    attribution = {"sessionId": sid(9), "source": "  TikTok ", "campaign": "launch", "contentCode": "clip-01"}
    assert place(anon, attribution=attribution).status_code == 201
    body = funnel(signed_in)
    row = body["bySource"][0]
    assert row["source"] == "tiktok" and row["ordersCreated"] == 1


def test_orders_without_attribution_are_direct_and_each_order_is_in_exactly_one_row(signed_in, anon):
    a, b = sellable(signed_in), sellable(signed_in)
    add(anon, a, 1)
    place(anon, attribution={"sessionId": sid(1), "source": "facebook"})
    other = TestClient(anon.app)
    add(other, b, 1)
    place(other)
    body = funnel(signed_in)
    rows = {r["source"]: r for r in body["bySource"]}
    assert rows["facebook"]["ordersCreated"] == 1 and rows[""]["ordersCreated"] == 1
    assert sum(r["ordersCreated"] for r in body["bySource"]) == body["totals"]["ordersCreated"] == 2


def test_the_source_filter_narrows_every_number(signed_in, anon):
    p = sellable(signed_in)
    sku = p["variants"][0]["sku"]
    send(anon, "product_view", 1, sku=sku, source="TikTok")
    send(anon, "product_view", 2, sku=sku, source="facebook")
    send(anon, "product_view", 3, sku=sku)
    assert steps(funnel(signed_in, source="tiktok"))["product_view"]["count"] == 1
    assert steps(funnel(signed_in, source="direct"))["product_view"]["count"] == 1
    assert steps(funnel(signed_in))["product_view"]["count"] == 3


def test_a_demo_order_is_left_out_by_default(signed_in, anon):
    p = sellable(signed_in)
    mark_demo(signed_in, p["id"])
    add(anon, p, 1)
    place(anon)
    assert funnel(signed_in)["totals"]["ordersCreated"] == 0
    assert funnel(signed_in, demo="include")["totals"]["ordersCreated"] == 1


# ================================================================== shopee and products
def test_a_shopee_click_is_counted_apart_and_is_never_an_order(signed_in, anon):
    p = sellable(signed_in)
    send(anon, "shopee_click", 1, sku=p["variants"][0]["sku"])
    send(anon, "shopee_click", 2, sku=p["variants"][0]["sku"])
    body = funnel(signed_in)
    assert body["shopeeClicks"] == 2 and body["totals"]["ordersCreated"] == 0
    assert body["topProducts"][0]["shopeeClicks"] == 2


def test_top_products_rank_by_distinct_viewing_sessions(signed_in, anon):
    popular, quiet = sellable(signed_in), sellable(signed_in)
    for n in (1, 2, 3):
        send(anon, "product_view", n, sku=popular["variants"][0]["sku"])
    send(anon, "product_view", 1, sku=quiet["variants"][0]["sku"])
    top = funnel(signed_in)["topProducts"]
    assert [r["sku"] for r in top] == [popular["variants"][0]["sku"], quiet["variants"][0]["sku"]]
    assert top[0]["viewers"] == 3 and top[0]["productName"]


# ================================================================== access and limits
def test_only_signed_in_staff_can_read_the_dashboard(anon, staff):
    assert anon.get(OVERVIEW).status_code == 401
    assert staff.get(OVERVIEW).status_code == 200


def test_the_period_is_validated(signed_in):
    backwards = signed_in.get(OVERVIEW, params={"from": "2026-02-02", "to": "2026-02-01"})
    too_long = signed_in.get(OVERVIEW, params={"from": "2024-01-01", "to": "2026-01-01"})
    assert backwards.status_code == 422 and backwards.json()["error"]["code"] == "invalid_range"
    assert too_long.status_code == 422 and too_long.json()["error"]["code"] == "range_too_long"


# ================================================================== the small formulas
def test_rate_is_none_for_a_zero_denominator_and_a_real_zero_otherwise():
    assert report.rate(3, 0) is None
    assert report.rate(0, 5) == 0.0
    assert report.rate(1, 4) == 0.25


def test_a_vietnam_day_starts_seven_hours_before_midnight_utc():
    start, end = report.day_bounds(date(2026, 11, 8), date(2026, 11, 8))
    assert start == datetime(2026, 11, 7, 17, 0, tzinfo=UTC)
    assert end == datetime(2026, 11, 8, 17, 0, tzinfo=UTC)
    assert report.day_bounds(date(2026, 11, 8), date(2026, 11, 9))[1] == datetime(
        2026, 11, 9, 17, 0, tzinfo=UTC
    )


def test_source_names_are_grouped_regardless_of_case_and_spaces():
    assert events.clean_source("  TikTok ") == events.clean_source("tiktok") == "tiktok"


def test_demo_flag_is_stored_on_the_product_not_guessed(signed_in, client):
    p = sellable(signed_in)
    with client.app.state.session_factory() as db:
        assert db.scalar(select(Product.is_demo).where(Product.id == p["id"])) is False
