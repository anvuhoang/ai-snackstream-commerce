"""payOS: signatures, the payment link, the webhook (replay, tampering, late money) and the browser return."""

from __future__ import annotations

from datetime import timedelta

import httpx
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from app.core.config import Settings
from app.core.db import utcnow
from app.main import create_app
from app.modules.orders import payos, service, stock
from app.modules.orders.models import Order, Payment

from .conftest import ADMIN_EMAIL, ADMIN_PASSWORD
from .test_orders import ADMIN_ORDERS, CART, ORDERS, PHONE, add, body, ensure_customer, key, sellable

KEY = "test-checksum-key-0123456789abcdef"
WEBHOOK = "/api/payments/payos/webhook"
RETURN = "/api/payments/payos/return"
PAY_LINK = "/api/orders/pay-link"

# The example in payOS's own documentation: a known payload, key and signature.
DOC_KEY = "1a54716c8f0efb2744fb28b6e38b25da7f67a925d98bc1c18bd8faaecadd7675"
DOC_DATA = {
    "orderCode": 123,
    "amount": 3000,
    "description": "VQRIO123",
    "accountNumber": "12345678",
    "reference": "TF230204212323",
    "transactionDateTime": "2023-02-04 18:25:00",
    "currency": "VND",
    "paymentLinkId": "124c33293c43417ab7879e14c8d9eb18",
    "code": "00",
    "desc": "Thành công",
    "counterAccountBankId": "",
    "counterAccountBankName": "",
    "counterAccountName": "",
    "counterAccountNumber": "",
    "virtualAccountName": "",
    "virtualAccountNumber": "",
}
DOC_SIGNATURE = "412e915d2871504ed31be63c8f62a149a4410d34c4c42affc9006ef9917eaa03"


class FakePayos:
    """Stands in for payOS's servers: remembers the links it was asked for and answers look-ups from `paid`."""

    def __init__(self) -> None:
        self.created: list[dict] = []
        self.paid: dict[int, int] = {}  # orderCode -> amount paid
        self.fail = False

    def client(self, settings: Settings) -> payos.PayosClient:
        def handler(request: httpx.Request) -> httpx.Response:
            if self.fail:
                return httpx.Response(500, json={"code": "20", "desc": "boom"})
            assert request.headers["x-client-id"] == "client-id" and request.headers["x-api-key"] == "api-key"
            if request.method == "POST":
                import json

                sent = json.loads(request.content)
                self.created.append(sent)
                good = sent["signature"] == payos.sign_payment_request(
                    KEY,
                    amount=sent["amount"],
                    cancel_url=sent["cancelUrl"],
                    description=sent["description"],
                    order_code=sent["orderCode"],
                    return_url=sent["returnUrl"],
                )
                if not good:
                    return httpx.Response(200, json={"code": "201", "desc": "invalid signature"})
                return httpx.Response(
                    200,
                    json={
                        "code": "00",
                        "desc": "success",
                        "data": {"checkoutUrl": "https://pay.payos.vn/web/abc"},
                    },
                )
            code = int(request.url.path.rsplit("/", 1)[1])
            data = {"orderCode": code, "amount": 0, "amountPaid": self.paid.get(code, 0)}
            data["status"] = "PAID" if code in self.paid else "PENDING"
            return httpx.Response(200, json={"code": "00", "desc": "success", "data": data})

        return payos.PayosClient(
            client_id="client-id",
            api_key="api-key",
            checksum_key=KEY,
            base_url="https://api-merchant.payos.vn",
            transport=httpx.MockTransport(handler),
        )


@pytest.fixture()
def fake(monkeypatch) -> FakePayos:
    f = FakePayos()
    monkeypatch.setattr(service, "_payos_client", f.client)
    return f


@pytest.fixture()
def online(settings: Settings, fake):
    on = settings.model_copy(
        update={"payos_client_id": "client-id", "payos_api_key": "api-key", "payos_checksum_key": KEY}
    )
    with TestClient(create_app(on)) as admin:
        r = admin.post("/api/admin/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD})
        admin.headers["X-CSRF-Token"] = r.json()["csrf"]
        yield admin, TestClient(admin.app)


def order_payos(admin: TestClient, visitor: TestClient, price: int = 100_000) -> dict:
    add(visitor, sellable(admin, price))
    ensure_customer(visitor)
    r = visitor.post(ORDERS, json=body(paymentMethod="payos"), headers={"Idempotency-Key": key()})
    assert r.status_code == 201, r.text
    return r.json()


def payment_of(admin: TestClient, code: str) -> tuple[int, int, int]:
    with admin.app.state.session_factory() as db:
        o = db.scalar(select(Order).where(Order.code == code))
        p = db.scalar(select(Payment).where(Payment.order_id == o.id))
        return o.id, p.id, o.total_vnd


def webhook_body(payment_id: int, amount: int, **overrides) -> dict:
    data = dict(DOC_DATA, orderCode=payment_id * payos.ORDER_CODE_SCALE + 7, amount=amount)
    top = {"code": "00", "desc": "success", "success": True}
    for k in ("code", "success"):
        if k in overrides:
            top[k] = overrides.pop(k)
    data.update(overrides)
    return {**top, "data": data, "signature": payos.sign_data(KEY, data)}


def state(admin: TestClient, code: str) -> tuple[str, list[str]]:
    with admin.app.state.session_factory() as db:
        o = db.scalar(select(Order).where(Order.code == code))
        return o.payments[0].status, [h.note for h in o.history]


# ================================================================== signatures
def test_the_signature_matches_the_example_in_payos_documentation():
    assert payos.sign_data(DOC_KEY, DOC_DATA) == DOC_SIGNATURE
    assert payos.verify_webhook(DOC_KEY, {"data": DOC_DATA, "signature": DOC_SIGNATURE})


def test_a_changed_amount_or_a_wrong_key_fails_verification():
    assert not payos.verify_webhook(DOC_KEY, {"data": dict(DOC_DATA, amount=1), "signature": DOC_SIGNATURE})
    assert not payos.verify_webhook("another-key", {"data": DOC_DATA, "signature": DOC_SIGNATURE})
    assert not payos.verify_webhook(DOC_KEY, {"data": DOC_DATA})
    assert not payos.verify_webhook(DOC_KEY, {"data": DOC_DATA, "signature": ""})
    assert not payos.verify_webhook(DOC_KEY, ["not", "an", "object"])


def test_an_order_number_leads_back_to_its_payment_and_never_collides():
    codes = {payos.new_order_code(42) for _ in range(50)}
    assert all(payos.payment_id_of(c) == 42 for c in codes)
    assert payos.payment_id_of(5) is None and payos.payment_id_of(True) is None
    assert payos.payment_id_of(payos.MAX_ORDER_CODE + 1) is None


def test_the_transfer_description_is_letters_and_digits_only():
    assert payos.description_for("SS-AB23-CD") == "SSAB23CD"


# ================================================================== the payment link
def test_payos_is_offered_only_once_the_keys_are_set(online, client):
    _, visitor = online
    assert visitor.get("/api/shop/config").json()["paymentMethods"] == ["cod", "payos"]
    assert client.get("/api/shop/config").json()["paymentMethods"] == ["cod"]


def test_checkout_returns_a_signed_link_for_the_exact_total_and_keeps_customer_data_out(online, fake):
    admin, visitor = online
    o = order_payos(admin, visitor, 100_000)
    assert o["paymentUrl"] == "https://pay.payos.vn/web/abc"
    assert o["paymentMethod"] == "payos" and o["expiresAt"] and o["payments"][0]["status"] == "pending"
    sent = fake.created[0]
    assert sent["amount"] == o["totalVnd"] and sent["expiredAt"] > 0
    _, pid, _ = payment_of(admin, o["code"])
    assert payos.payment_id_of(sent["orderCode"]) == pid
    assert (
        "buyerName" not in sent and "buyerPhone" not in sent
    )  # the gateway is told what it needs, nothing more
    assert KEY not in str(sent)


def test_if_payos_is_down_the_order_still_exists_and_can_be_paid_later(online, fake):
    admin, visitor = online
    fake.fail = True
    o = order_payos(admin, visitor)
    assert o["paymentUrl"] is None and o["payments"][0]["status"] == "pending"
    fake.fail = False
    r = visitor.post(PAY_LINK, json={"code": o["code"], "phone": PHONE})
    assert r.status_code == 200 and r.json()["paymentUrl"] == "https://pay.payos.vn/web/abc"
    assert visitor.post(PAY_LINK, json={"code": o["code"], "phone": "0999999999"}).status_code == 404


def test_every_new_link_gets_its_own_order_number_but_settles_the_same_payment(online, fake):
    admin, visitor = online
    o = order_payos(admin, visitor)
    visitor.post(PAY_LINK, json={"code": o["code"], "phone": PHONE})
    first, second = (c["orderCode"] for c in fake.created)
    _, pid, _ = payment_of(admin, o["code"])
    assert payos.payment_id_of(first) == payos.payment_id_of(second) == pid


def test_payos_cannot_be_chosen_while_it_is_switched_off(signed_in):
    visitor = TestClient(signed_in.app)
    add(visitor, sellable(signed_in, 100_000))
    ensure_customer(visitor)
    r = visitor.post(ORDERS, json=body(paymentMethod="payos"), headers={"Idempotency-Key": key()})
    assert r.status_code == 422 and r.json()["error"]["code"] == "payment_method_unavailable"


# ================================================================== the webhook
def test_a_signed_successful_webhook_marks_the_payment_paid_once(online):
    admin, visitor = online
    o = order_payos(admin, visitor)
    _, pid, total = payment_of(admin, o["code"])
    for _ in range(3):  # payOS retries; only the first changes anything
        r = visitor.post(WEBHOOK, json=webhook_body(pid, total))
        assert r.status_code == 200
    status, notes = state(admin, o["code"])
    assert status == "paid" and notes.count("Paid online (payOS)") == 1


def test_a_webhook_with_a_bad_signature_is_refused_and_changes_nothing(online):
    admin, visitor = online
    o = order_payos(admin, visitor)
    _, pid, total = payment_of(admin, o["code"])
    forged = webhook_body(pid, total)
    forged["signature"] = "0" * 64
    assert visitor.post(WEBHOOK, json=forged).status_code == 400
    tampered = webhook_body(pid, total)
    tampered["data"]["amount"] = 1  # amount changed after signing
    assert visitor.post(WEBHOOK, json=tampered).status_code == 400
    assert visitor.post(WEBHOOK, content=b"not json").status_code == 400
    assert state(admin, o["code"])[0] == "pending"


def test_a_webhook_for_a_different_amount_does_not_pay_the_order(online):
    admin, visitor = online
    o = order_payos(admin, visitor, 100_000)
    _, pid, total = payment_of(admin, o["code"])
    assert visitor.post(WEBHOOK, json=webhook_body(pid, total - 1)).status_code == 200
    assert state(admin, o["code"])[0] == "pending"


def test_a_failed_payment_webhook_does_not_pay_the_order(online):
    admin, visitor = online
    o = order_payos(admin, visitor)
    _, pid, total = payment_of(admin, o["code"])
    visitor.post(WEBHOOK, json=webhook_body(pid, total, success=False, code="01"))
    assert state(admin, o["code"])[0] == "pending"


def test_payos_test_call_for_an_unknown_order_is_answered_normally(online):
    _, visitor = online
    sample = webhook_body(1, 3000)
    sample["data"]["orderCode"] = 123  # payOS's own sample number: not ours
    sample["signature"] = payos.sign_data(KEY, sample["data"])
    assert visitor.post(WEBHOOK, json=sample).status_code == 200


def test_money_that_arrives_after_the_order_expired_is_recorded_for_a_refund(online):
    admin, visitor = online
    o = order_payos(admin, visitor)
    _, pid, total = payment_of(admin, o["code"])
    set_expires(admin, o["code"], timedelta(minutes=-1))
    admin.get("/api/admin/orders")  # listing expires due orders
    assert state(admin, o["code"])[0] == "expired"
    assert visitor.post(WEBHOOK, json=webhook_body(pid, total)).status_code == 200
    status, notes = state(admin, o["code"])
    assert status == "expired" and any("refund" in n for n in notes)


def test_the_back_office_cannot_move_an_unpaid_payos_order_forward(online):
    admin, visitor = online
    o = order_payos(admin, visitor)
    oid, pid, total = payment_of(admin, o["code"])
    url = f"/api/admin/orders/{oid}/status"
    assert admin.post(url, json={"to": "confirmed"}).status_code == 409
    visitor.post(WEBHOOK, json=webhook_body(pid, total))
    assert admin.post(url, json={"to": "confirmed"}).status_code == 200


# ================================================================== the browser return
def test_return_asks_payos_and_marks_the_payment_paid_when_the_webhook_has_not_arrived(online, fake):
    admin, visitor = online
    o = order_payos(admin, visitor)
    _, pid, total = payment_of(admin, o["code"])
    code = fake.created[0]["orderCode"]
    q = {"orderCode": code, "cancel": "false", "status": "PAID"}
    assert visitor.get(RETURN, params=q).json() == {
        "result": "pending",
        "orderCode": o["code"],
    }  # payOS says not paid yet
    fake.paid[code] = total
    assert visitor.get(RETURN, params=q).json() == {"result": "paid", "orderCode": o["code"]}
    assert state(admin, o["code"])[0] == "paid"
    assert payos.payment_id_of(code) == pid


def test_the_return_query_string_alone_never_pays_an_order(online):
    admin, visitor = online
    o = order_payos(admin, visitor)
    _, pid, _ = payment_of(admin, o["code"])
    q = {"orderCode": pid * payos.ORDER_CODE_SCALE + 1, "cancel": "false", "status": "PAID", "code": "00"}
    assert visitor.get(RETURN, params=q).json()["result"] == "pending"
    assert state(admin, o["code"])[0] == "pending"


def test_a_cancelled_return_is_reported_as_not_paid(online):
    admin, visitor = online
    o = order_payos(admin, visitor)
    _, pid, _ = payment_of(admin, o["code"])
    q = {"orderCode": pid * payos.ORDER_CODE_SCALE + 1, "cancel": "true", "status": "CANCELLED"}
    assert visitor.get(RETURN, params=q).json() == {"result": "failed", "orderCode": o["code"]}


def test_return_with_a_number_that_is_not_ours_is_invalid(online):
    _, visitor = online
    assert visitor.get(RETURN, params={"orderCode": "abc"}).json()["result"] == "invalid"
    assert visitor.get(RETURN, params={"orderCode": 99}).json()["result"] == "invalid"
    assert visitor.get(RETURN, params={"orderCode": 999_990_000}).json()["result"] == "invalid"


@pytest.fixture()
def counted_stock(monkeypatch):
    calls = {"release": 0}
    monkeypatch.setattr(
        stock, "release", lambda db, order: calls.__setitem__("release", calls["release"] + 1)
    )
    return calls


def set_expires(admin: TestClient, code: str, delta: timedelta) -> None:
    with admin.app.state.session_factory() as db:
        o = db.scalar(select(Order).where(Order.code == code))
        o.expires_at = utcnow() + delta
        db.commit()


# ================================================================== expiry
def test_an_unpaid_order_expires_and_gives_its_stock_back_once(online, counted_stock):
    admin, visitor = online
    o = order_payos(admin, visitor)
    oid, _, _ = payment_of(admin, o["code"])
    set_expires(admin, o["code"], timedelta(minutes=-1))
    first = admin.get(f"{ADMIN_ORDERS}/{oid}").json()
    assert first["status"] == "cancelled" and first["payments"][0]["status"] == "expired"
    assert (
        first["history"][-1]["note"] == "Payment time ran out" and first["history"][-1]["actorEmail"] is None
    )
    admin.get(f"{ADMIN_ORDERS}/{oid}")
    admin.get(ADMIN_ORDERS)
    with admin.app.state.session_factory() as db:
        assert service.expire_due_orders(db) == 0
    assert counted_stock["release"] == 1  # exactly once


def test_an_order_that_is_not_due_yet_is_left_alone(online, counted_stock):
    admin, visitor = online
    o = order_payos(admin, visitor)
    oid, _, _ = payment_of(admin, o["code"])
    set_expires(admin, o["code"], timedelta(minutes=5))
    assert admin.get(f"{ADMIN_ORDERS}/{oid}").json()["status"] == "new"
    assert counted_stock["release"] == 0


def test_a_paid_order_does_not_expire(online, counted_stock):
    admin, visitor = online
    o = order_payos(admin, visitor)
    oid, pid, total = payment_of(admin, o["code"])
    visitor.post(WEBHOOK, json=webhook_body(pid, total))
    with admin.app.state.session_factory() as db:
        assert service.expire_due_orders(db) == 0
    assert admin.get(f"{ADMIN_ORDERS}/{oid}").json()["status"] == "new"


def test_the_expiry_job_cancels_every_due_order(online, counted_stock):
    admin, visitor = online
    codes = []
    for _ in range(3):
        codes.append(order_payos(admin, visitor)["code"])
    for c in codes[:2]:
        set_expires(admin, c, timedelta(seconds=-5))
    with admin.app.state.session_factory() as db:
        assert service.expire_due_orders(db) == 2
    statuses = sorted(i["status"] for i in admin.get(ADMIN_ORDERS).json()["items"])
    assert statuses == ["cancelled", "cancelled", "new"] and counted_stock["release"] == 2


def test_a_customer_looking_up_an_expired_order_sees_it_cancelled(online):
    admin, visitor = online
    o = order_payos(admin, visitor)
    set_expires(admin, o["code"], timedelta(minutes=-1))
    r = TestClient(admin.app).post(f"{ORDERS}/lookup", json={"code": o["code"], "phone": PHONE})
    assert r.status_code == 200 and r.json()["status"] == "cancelled"


def test_cash_on_delivery_orders_never_expire(online, counted_stock):
    admin, visitor = online
    add(visitor, sellable(admin))
    ensure_customer(visitor)
    assert visitor.post(ORDERS, json=body(), headers={"Idempotency-Key": key()}).json()["expiresAt"] is None
    with admin.app.state.session_factory() as db:
        assert service.expire_due_orders(db) == 0
    assert visitor.get(CART).status_code == 200
