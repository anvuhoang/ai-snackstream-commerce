import json
from unittest.mock import MagicMock

import pytest
from pydantic import SecretStr
from sqlalchemy import select
from sqlalchemy.exc import OperationalError

from app.core.errors import AppError
from app.modules.catalog.models import Variant
from app.modules.live import catalog
from app.modules.live.dispatcher import dispatch_next_question
from app.modules.live.schemas import LiveQuestionIn, LiveSessionCreate


def running(client, make=False):
    live = client.app.state.live
    session = live.create_session(
        LiveSessionCreate(
            title="Catalog grounding",
            scheduledSkus=["KG-LC-250", "BT-XIKE-01"],
            products=[
                {"sku": "KG-LC-250", "name": "Wrong narration name", "facts": "Wrong narration price 1 VND"}
            ],
        )
    )
    live.start_session(session.live_id)
    settings = client.app.state.settings
    settings.live_make_enabled = make
    settings.live_make_webhook_url = SecretStr("https://make.example.invalid/test")
    return live, session.live_id, settings


def question(live, sid, index=0):
    return live.submit_question(
        sid,
        LiveQuestionIn(
            questionId=f"catalog-question-{index}",
            sessionId="catalog-viewer-001",
            text="Giá và bảo quản?",
        ),
    )


def test_dispatch_uses_current_database_not_narration_or_new_pin(client, live_catalog, monkeypatch):
    live, sid, settings = running(client, make=True)
    original = question(live, sid)
    live.pin_sku(sid, "BT-XIKE-01")
    with client.app.state.session_factory() as db:
        v = db.scalar(select(Variant).where(Variant.sku == original.sku))
        v.price_vnd = 79000
        db.commit()
    response = MagicMock()
    response.__enter__.return_value.status = 202
    sender = MagicMock(return_value=response)
    monkeypatch.setattr("app.modules.live.make_bridge.urlopen", sender)
    dispatch_next_question(sid, live, settings)
    payload = json.loads(sender.call_args.args[0].data)
    assert payload["current_live_sku"] == payload["product"]["sku"] == original.sku == "KG-LC-250"
    assert payload["product"]["name"] == "Catalog KG-LC-250"
    assert "79000" in payload["product"]["facts"]
    assert "Keep dry from database" in payload["product"]["facts"]
    assert "Wrong narration" not in payload["product"]["facts"]
    assert "Chưa có dữ liệu" in payload["product"]["facts"]  # Missing allergy/nutrition != none.
    assert type(payload["deadline_unix_ms"]) is int
    same = question(live, sid)
    assert same.sku == original.sku
    assert same.product.model_dump() == payload["product"]
    dispatch_next_question(sid, live, settings)
    sender.assert_called_once()


@pytest.mark.parametrize(
    "change,code",
    [
        ("missing", "product_not_found"),
        ("hidden", "product_not_found"),
        ("inactive", "product_not_found"),
        ("empty", "live_product_incomplete"),
        ("query", "live_catalog_unavailable"),
    ],
)
def test_catalog_failure_is_terminal_no_network_and_next_question_can_run(
    client,
    live_catalog,
    monkeypatch,
    change,
    code,
):
    live, sid, settings = running(client, make=True)
    question(live, sid)
    live.pin_sku(sid, "BT-XIKE-01")
    question(live, sid, 1)
    with client.app.state.session_factory() as db:
        v = db.scalar(select(Variant).where(Variant.sku == "KG-LC-250"))
        if change == "missing":
            v.sku = "OTHER-01"
        elif change == "hidden":
            v.product.status = "hidden"
        elif change == "inactive":
            v.is_active = False
        elif change == "empty":
            v.product.description = v.product.ingredients = v.product.storage = ""
        db.commit()
    original = catalog.product_for_sku
    if change == "query":

        def broken(*args):
            raise OperationalError("private DB error", {}, Exception("sensitive"))

        monkeypatch.setattr(catalog, "product_for_sku", broken)
    sender = MagicMock(return_value=200)
    monkeypatch.setattr("app.modules.live.dispatcher.send_make_question", sender)
    dispatch_next_question(sid, live, settings)
    failed = live.get_current().questions[0]
    assert (failed.status, failed.error_code, failed.product) == ("failed", code, None)
    sender.assert_not_called()
    monkeypatch.setattr(catalog, "product_for_sku", original)
    dispatch_next_question(sid, live, settings)
    assert live.get_current().questions[1].status == "processing"
    assert sender.call_args.args[0].sku == "BT-XIKE-01"


def test_optional_database_fields_are_explicit_unknown_not_claims(client, live_catalog):
    product = catalog.load_answer_product(live_catalog, "KG-LC-250")
    assert "Dị ứng: Chưa có dữ liệu" in product.facts
    assert "Dinh dưỡng: Chưa có dữ liệu" in product.facts
    assert "Thành phần: Verified database ingredients" in product.facts


def test_exact_variant_is_used_instead_of_cheapest_sibling(client, live_catalog):
    with client.app.state.session_factory() as db:
        variant = db.scalar(select(Variant).where(Variant.sku == "KG-LC-250"))
        db.add(
            Variant(
                product_id=variant.product_id,
                sku="KG-LC-100",
                name="Small sibling",
                price_vnd=1000,
                weight_g=100,
                sort_order=-1,
            )
        )
        db.commit()
    detail = client.get("/api/live/products/KG-LC-250").json()
    assert detail["variants"][0]["sku"] == "KG-LC-100"
    evidence = catalog.load_answer_product(live_catalog, "KG-LC-250")
    assert evidence.sku == "KG-LC-250"
    assert "Giá (VND): 65000" in evidence.facts
    assert "Khối lượng (g): 250" in evidence.facts
    assert "Small sibling" not in evidence.facts


def test_pin_unpin_preserves_question_context_and_shared_cart(signed_in, live_catalog, anon):
    c = signed_in
    live, sid, _ = running(c)
    response = c.post(f"/api/admin/live/{sid}/pin", json={"sku": "KG-LC-250"})
    assert response.status_code == 200
    assert response.json()["productPinned"] is True
    q = question(live, sid)
    assert c.post(f"/api/admin/live/{sid}/pin", json={"sku": None}).json()["productPinned"] is False
    assert c.get("/api/live/current").json()["session"]["pinnedSku"] == q.sku
    assert question(live, sid, 1).sku == q.sku
    assert c.post(f"/api/admin/live/{sid}/pin", json={"sku": "BT-XIKE-01"}).status_code == 200
    assert live.get_current().questions[0].sku == "KG-LC-250"
    detail = anon.get("/api/live/products/BT-XIKE-01").json()
    assert detail["name"] == "Catalog BT-XIKE-01"
    assert anon.get(f"/api/catalog/products/{detail['slug']}").json() == detail
    variant = next(v for v in detail["variants"] if v["sku"] == "BT-XIKE-01")
    cart = anon.post("/api/cart/items", json={"variantId": variant["id"], "qty": 1})
    assert cart.status_code == 200, cart.text
    assert cart.json()["items"][0]["sku"] == "BT-XIKE-01"
    assert anon.post(f"/api/admin/live/{sid}/pin", json={"sku": None}).status_code == 401
    live.end_session(sid)
    assert c.post(f"/api/admin/live/{sid}/pin", json={"sku": None}).status_code == 409


@pytest.mark.parametrize("mode", ["simli", "playlist"])
def test_pin_cannot_change_audio_or_playlist_sku(client, live_catalog, mode):
    from app.modules.live.schemas import LiveScriptSegment

    live = client.app.state.live
    data = LiveSessionCreate(title="Bound audio", scheduledSkus=["KG-LC-250", "BT-XIKE-01"])
    if mode == "simli":
        data.host_mode = "simli"
    else:
        data.script_playlist = [
            LiveScriptSegment(
                name="A", sku="KG-LC-250", videoUrl="https://example.invalid/a.mp4", durationSeconds=40
            )
        ]
    sid = live.create_session(data).live_id
    if mode == "playlist":
        live.start_session(sid)
    assert live.pin_sku(sid, None).product_pinned is False
    assert live.pin_sku(sid, "KG-LC-250").product_pinned is True
    with pytest.raises(AppError) as caught:
        live.pin_sku(sid, "BT-XIKE-01")
    assert caught.value.code == (
        "host_audio_controls_sku" if mode == "simli" else "live_playlist_controls_sku"
    )
    assert live.get_current().pinned_sku == "KG-LC-250"


def test_unavailable_catalog_pin_does_not_mutate_state(signed_in, live_catalog, monkeypatch):
    from app.modules.live import router

    live, sid, _ = running(signed_in)
    before = live.get_current()

    def broken(*args):
        raise OperationalError("private SQL", {}, Exception("private"))

    monkeypatch.setattr(router, "product_for_sku", broken)
    response = signed_in.post(f"/api/admin/live/{sid}/pin", json={"sku": "BT-XIKE-01"})
    assert response.status_code == 503
    assert "private" not in response.text
    assert live.get_current() == before
    assert signed_in.get("/api/live/products/KG-LC-250").status_code == 503


@pytest.mark.parametrize("csrf", ["", "invalid-csrf"])
def test_pin_requires_admin_and_valid_csrf(signed_in, live_catalog, staff, csrf):
    live, sid, _ = running(signed_in)
    before = live.get_current()
    response = signed_in.post(
        f"/api/admin/live/{sid}/pin", json={"sku": None}, headers={"X-CSRF-Token": csrf}
    )
    assert response.status_code == 403
    assert response.json()["error"]["code"] == "csrf_invalid"
    response = staff.post(f"/api/admin/live/{sid}/pin", json={"sku": None})
    assert response.status_code == 403
    assert response.json()["error"]["code"] == "forbidden"
    assert live.get_current() == before


@pytest.mark.parametrize("interruption", ["deadline", "skip", "end"])
def test_catalog_io_cannot_revive_expired_skipped_or_ended_question(
    client,
    live_catalog,
    monkeypatch,
    interruption,
):
    from datetime import UTC, datetime, timedelta

    from app.modules.live import dispatcher, service

    class Clock(datetime):
        current = datetime.now(UTC)

        @classmethod
        def now(cls, tz=None):
            return cls.current

    monkeypatch.setattr(service, "datetime", Clock)
    live, sid, settings = running(client, make=True)
    first = question(live, sid)
    question(live, sid, 1)
    original = dispatcher.load_answer_product

    def interrupted(*args):
        product = original(*args)
        if interruption == "deadline":
            Clock.current += timedelta(seconds=settings.live_make_result_timeout_seconds)
        elif interruption == "skip":
            live.skip_question(sid, first.question_id)
        else:
            live.end_session(sid)
        return product

    monkeypatch.setattr(dispatcher, "load_answer_product", interrupted)
    sender = MagicMock()
    monkeypatch.setattr(dispatcher, "send_make_question", sender)
    dispatch_next_question(sid, live, settings)
    sender.assert_not_called()
    first = live.get_current().questions[0]
    assert first.status == ("failed" if interruption == "deadline" else "skipped")
    assert first.product is None
    if interruption != "end":
        monkeypatch.setattr(dispatcher, "load_answer_product", original)
        dispatch_next_question(sid, live, settings)
        assert sender.call_args.args[0].question_id == "catalog-question-1"


@pytest.mark.parametrize("query_fails", [False, True])
def test_simli_lease_expiry_during_catalog_io_prevents_webhook(
    client, live_catalog, monkeypatch, query_fails
):
    from datetime import UTC, datetime, timedelta

    from app.modules.live import dispatcher, service, simli_host
    from app.modules.live.schemas import LiveHostActionIn

    class Clock(datetime):
        current = datetime.now(UTC)

        @classmethod
        def now(cls, tz=None):
            return cls.current

    monkeypatch.setattr(service, "datetime", Clock)
    live = client.app.state.live
    sid = live.create_session(
        LiveSessionCreate(
            title="Slow catalog",
            hostMode="simli",
            scheduledSkus=["KG-LC-250"],
        )
    ).live_id
    acquired = simli_host.acquire(
        live, sid, "admin", "producer-catalog-001", 43, audio_sku="KG-LC-250", now=Clock.current
    )
    simli_host.token_permission(live, sid, "admin", "producer-catalog-001", acquired["leaseId"])
    simli_host.action(
        live,
        sid,
        "admin",
        acquired["leaseId"],
        LiveHostActionIn(
            clientId="producer-catalog-001",
            requestId="catalog-ready-001",
            action="ready",
        ),
        now=Clock.current,
    )
    question(live, sid)
    settings = client.app.state.settings
    settings.live_make_enabled = True
    original = dispatcher.load_answer_product

    def slow(*args):
        product = original(*args)
        Clock.current += timedelta(seconds=6)
        if query_fails:
            raise AppError(503, "live_catalog_unavailable", "Unavailable")
        return product

    sender = MagicMock()
    monkeypatch.setattr(dispatcher, "load_answer_product", slow)
    monkeypatch.setattr(dispatcher, "send_make_question", sender)
    dispatch_next_question(sid, live, settings)
    sender.assert_not_called()
    ended = live.get_current()
    assert ended.status == "ended"
    assert ended.questions[0].status == "skipped"
    assert ended.questions[0].product is None
