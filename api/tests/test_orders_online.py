"""Online payment (VNPay sandbox): signed URL, the gateway's callback, replay and tampering, and unpaid orders expiring."""

from __future__ import annotations

from datetime import timedelta
from urllib.parse import parse_qs, urlparse

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from app.core.config import Settings
from app.core.db import utcnow
from app.main import create_app
from app.modules.orders import service, stock, vnpay
from app.modules.orders.models import Order, Payment

from .conftest import ADMIN_EMAIL, ADMIN_PASSWORD
from .test_orders import ADMIN_ORDERS, CART, ORDERS, PHONE, add, body, go, key, sellable

SECRET = "sandbox-secret-for-tests"
TMN = "TESTTMN1"
IPN = "/api/payments/vnpay/ipn"
RETURN = "/api/payments/vnpay/return"


@pytest.fixture()
def online(settings: Settings):
    """An app with the gateway keys set; returns (admin client, visitor client)."""
    on = settings.model_copy(update={"vnpay_tmn_code": TMN, "vnpay_hash_secret": SECRET})
    with TestClient(create_app(on)) as admin:
        r = admin.post("/api/admin/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD})
        admin.headers["X-CSRF-Token"] = r.json()["csrf"]
        yield admin, TestClient(admin.app)


@pytest.fixture()
def counted_stock(monkeypatch):
    calls = {"release": 0}
    monkeypatch.setattr(
        stock, "release", lambda db, order: calls.__setitem__("release", calls["release"] + 1)
    )
    return calls


def order_online(admin: TestClient, visitor: TestClient, price: int = 100_000) -> dict:
    add(visitor, sellable(admin, price))
    r = visitor.post(ORDERS, json=body(paymentMethod="vnpay"), headers={"Idempotency-Key": key()})
    assert r.status_code == 201, r.text
    return r.json()


def ids(admin: TestClient, code: str) -> tuple[int, int, int]:
    """(order id, payment id, total) read straight from the database."""
    with admin.app.state.session_factory() as db:
        o = db.scalar(select(Order).where(Order.code == code))
        p = db.scalar(select(Payment).where(Payment.order_id == o.id))
        return o.id, p.id, o.total_vnd


def callback(order_id: int, payment_id: int, total: int, **overrides) -> dict[str, str]:
    """What VNPay sends us after a payment, signed with the shared secret."""
    params = {
        "vnp_TmnCode": TMN,
        "vnp_Amount": str(total * 100),
        "vnp_BankCode": "NCB",
        "vnp_OrderInfo": "Thanh toan don hang",
        "vnp_PayDate": "20261108120000",
        "vnp_ResponseCode": "00",
        "vnp_TransactionNo": "14400001",
        "vnp_TransactionStatus": "00",
        "vnp_TxnRef": vnpay.txn_ref(order_id, payment_id),
    }
    params.update(overrides)
    params["vnp_SecureHash"] = vnpay.sign(SECRET, params)
    return params


def set_expires(admin: TestClient, code: str, delta: timedelta) -> None:
    with admin.app.state.session_factory() as db:
        o = db.scalar(select(Order).where(Order.code == code))
        o.expires_at = utcnow() + delta
        db.commit()


# ================================================================== signed URL
def test_the_payment_url_is_signed_and_carries_the_amount(online):
    admin, visitor = online
    o = order_online(admin, visitor, 100_000)
    assert o["paymentMethod"] == "vnpay" and o["expiresAt"] and o["payments"][0]["status"] == "pending"
    url = urlparse(o["paymentUrl"])
    assert url.netloc == "sandbox.vnpayment.vn"
    q = {k: v[0] for k, v in parse_qs(url.query).items()}
    assert (
        q["vnp_TmnCode"] == TMN and q["vnp_Amount"] == str(o["totalVnd"] * 100) and q["vnp_CurrCode"] == "VND"
    )
    assert q["vnp_ReturnUrl"].endswith("/checkout/result")
    assert vnpay.verify(SECRET, q)  # signed with our secret over exactly these fields
    q["vnp_Amount"] = "1"
    assert not vnpay.verify(SECRET, q)  # change anything and the signature no longer fits


def test_online_payment_is_offered_once_the_keys_are_set(online):
    _, visitor = online
    assert visitor.get("/api/shop/config").json()["paymentMethods"] == ["cod", "vnpay"]


def test_the_secret_is_never_part_of_the_url(online):
    admin, visitor = online
    assert SECRET not in order_online(admin, visitor)["paymentUrl"]


# ================================================================== the callback
def test_a_valid_callback_marks_the_payment_paid(online):
    admin, visitor = online
    o = order_online(admin, visitor)
    oid, pid, total = ids(admin, o["code"])
    r = visitor.get(IPN, params=callback(oid, pid, total))
    assert r.json() == {"RspCode": "00", "Message": "Confirm Success"}
    full = admin.get(f"{ADMIN_ORDERS}/{oid}").json()
    assert full["payments"][0]["status"] == "paid" and full["payments"][0]["paidAt"]
    assert full["expiresAt"] is None  # no longer at risk of expiring
    assert any("VNPay" in h["note"] for h in full["history"])


def test_the_same_callback_twice_changes_nothing_the_second_time(online):
    admin, visitor = online
    o = order_online(admin, visitor)
    oid, pid, total = ids(admin, o["code"])
    params = callback(oid, pid, total)
    assert visitor.get(IPN, params=params).json()["RspCode"] == "00"
    assert visitor.get(IPN, params=params).json() == {"RspCode": "02", "Message": "Order already confirmed"}
    full = admin.get(f"{ADMIN_ORDERS}/{oid}").json()
    assert full["payments"][0]["status"] == "paid" and len(full["history"]) == 2


def test_a_tampered_callback_is_rejected(online):
    admin, visitor = online
    o = order_online(admin, visitor)
    oid, pid, total = ids(admin, o["code"])
    params = callback(oid, pid, total)
    params["vnp_Amount"] = "100"  # pay one dong, claim it was paid in full
    assert visitor.get(IPN, params=params).json()["RspCode"] == "97"
    params = callback(oid, pid, total)
    params["vnp_SecureHash"] = "0" * 128
    assert visitor.get(IPN, params=params).json()["RspCode"] == "97"
    assert admin.get(f"{ADMIN_ORDERS}/{oid}").json()["payments"][0]["status"] == "pending"


def test_a_callback_signed_for_the_wrong_amount_is_refused(online):
    admin, visitor = online
    o = order_online(admin, visitor)
    oid, pid, total = ids(admin, o["code"])
    r = visitor.get(
        IPN, params=callback(oid, pid, total, vnp_Amount="100")
    )  # correctly signed, but not the order total
    assert r.json()["RspCode"] == "04"
    assert admin.get(f"{ADMIN_ORDERS}/{oid}").json()["payments"][0]["status"] == "pending"


def test_an_unknown_reference_is_refused(online):
    admin, visitor = online
    order_online(admin, visitor)
    assert visitor.get(IPN, params=callback(999, 999, 1)).json()["RspCode"] == "01"
    assert visitor.get(IPN).json()["RspCode"] == "97"  # no signature at all


def test_a_failed_payment_is_recorded_as_failed(online):
    admin, visitor = online
    o = order_online(admin, visitor)
    oid, pid, total = ids(admin, o["code"])
    r = visitor.get(IPN, params=callback(oid, pid, total, vnp_ResponseCode="24", vnp_TransactionStatus="02"))
    assert r.json()["RspCode"] == "00"  # we received it fine; the payment itself failed
    assert admin.get(f"{ADMIN_ORDERS}/{oid}").json()["payments"][0]["status"] == "failed"


def test_an_online_order_cannot_be_confirmed_before_it_is_paid(online):
    admin, visitor = online
    o = order_online(admin, visitor)
    oid, pid, total = ids(admin, o["code"])
    r = go(admin, oid, "confirmed")
    assert r.status_code == 409 and r.json()["error"]["code"] == "payment_not_received"
    assert admin.get(f"{ADMIN_ORDERS}/{oid}").json()["nextStatuses"] == ["cancelled"]
    visitor.get(IPN, params=callback(oid, pid, total))
    assert go(admin, oid, "confirmed").status_code == 200


# ================================================================== the browser's return
def test_the_return_page_reports_what_the_callback_recorded(online):
    admin, visitor = online
    o = order_online(admin, visitor)
    oid, pid, total = ids(admin, o["code"])
    params = callback(oid, pid, total)
    # the customer is back but the callback has not arrived yet
    assert visitor.get(RETURN, params=params).json() == {"result": "pending", "orderCode": o["code"]}
    visitor.get(IPN, params=params)
    assert visitor.get(RETURN, params=params).json() == {"result": "paid", "orderCode": o["code"]}
    # the browser return alone never marks anything paid, and a forged one is called invalid
    forged = dict(params, vnp_Amount="5")
    assert visitor.get(RETURN, params=forged).json() == {"result": "invalid", "orderCode": None}


def test_the_return_page_is_read_only(online):
    admin, visitor = online
    o = order_online(admin, visitor)
    oid, pid, total = ids(admin, o["code"])
    visitor.get(RETURN, params=callback(oid, pid, total))
    assert admin.get(f"{ADMIN_ORDERS}/{oid}").json()["payments"][0]["status"] == "pending"


# ================================================================== expiry
def test_an_unpaid_order_expires_and_gives_its_stock_back_once(online, counted_stock):
    admin, visitor = online
    o = order_online(admin, visitor)
    oid, _, _ = ids(admin, o["code"])
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
    o = order_online(admin, visitor)
    oid, _, _ = ids(admin, o["code"])
    set_expires(admin, o["code"], timedelta(minutes=5))
    assert admin.get(f"{ADMIN_ORDERS}/{oid}").json()["status"] == "new"
    assert counted_stock["release"] == 0


def test_a_paid_order_does_not_expire(online, counted_stock):
    admin, visitor = online
    o = order_online(admin, visitor)
    oid, pid, total = ids(admin, o["code"])
    visitor.get(IPN, params=callback(oid, pid, total))
    with admin.app.state.session_factory() as db:
        assert service.expire_due_orders(db) == 0
    assert admin.get(f"{ADMIN_ORDERS}/{oid}").json()["status"] == "new"


def test_the_expiry_job_cancels_every_due_order(online, counted_stock):
    admin, visitor = online
    codes = []
    for _ in range(3):
        codes.append(order_online(admin, visitor)["code"])
    for c in codes[:2]:
        set_expires(admin, c, timedelta(seconds=-5))
    with admin.app.state.session_factory() as db:
        assert service.expire_due_orders(db) == 2
    statuses = sorted(i["status"] for i in admin.get(ADMIN_ORDERS).json()["items"])
    assert statuses == ["cancelled", "cancelled", "new"] and counted_stock["release"] == 2


def test_a_customer_looking_up_an_expired_order_sees_it_cancelled(online):
    admin, visitor = online
    o = order_online(admin, visitor)
    set_expires(admin, o["code"], timedelta(minutes=-1))
    r = TestClient(admin.app).post(f"{ORDERS}/lookup", json={"code": o["code"], "phone": PHONE})
    assert r.status_code == 200 and r.json()["status"] == "cancelled"


def test_cash_on_delivery_orders_never_expire(online, counted_stock):
    admin, visitor = online
    add(visitor, sellable(admin))
    assert visitor.post(ORDERS, json=body(), headers={"Idempotency-Key": key()}).json()["expiresAt"] is None
    with admin.app.state.session_factory() as db:
        assert service.expire_due_orders(db) == 0
    assert visitor.get(CART).status_code == 200
