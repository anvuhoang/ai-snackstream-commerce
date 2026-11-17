"""Customer accounts: sign-up, sign-in, profile, the rule that only a signed-in customer can check out, and own-order history."""

from __future__ import annotations

import uuid

from fastapi.testclient import TestClient

from .test_orders import ORDERS, add, body, key, place, sellable

ACCOUNT = "/api/account"
PASSWORD = "buyer-password-1"


def signup(c: TestClient, email: str | None = None, **overrides) -> dict:
    payload = {
        "email": email or f"shopper-{uuid.uuid4().hex[:8]}@example.com",
        "password": PASSWORD,
        "fullName": "Trần Thị Bích",
        "phone": "0912345678",
    }
    payload.update(overrides)
    return c.post(f"{ACCOUNT}/register", json=payload)


def sign_in(c: TestClient, email: str, password: str = PASSWORD):
    r = c.post(f"{ACCOUNT}/login", json={"email": email, "password": password})
    if r.status_code == 200:
        c.headers["X-CSRF-Token"] = r.json()["csrf"]
    return r


# ================================================================== sign-up and sign-in
def test_signing_up_creates_the_account_and_signs_in(anon):
    r = signup(anon, "Bich@Example.com")
    assert r.status_code == 201
    out = r.json()
    assert out["customer"]["email"] == "bich@example.com"  # e-mails are stored lower-case
    assert out["customer"]["fullName"] == "Trần Thị Bích" and out["customer"]["phone"] == "0912345678"
    assert "passwordHash" not in str(out) and out["csrf"]
    assert anon.get(f"{ACCOUNT}/me").json()["customer"]["email"] == "bich@example.com"


def test_a_visitor_asking_who_they_are_gets_null_not_an_error(anon):
    r = anon.get(f"{ACCOUNT}/me")
    assert r.status_code == 200 and r.json() == {"customer": None, "csrf": None}


def test_the_same_email_cannot_sign_up_twice(anon):
    assert signup(anon, "dup@example.com").status_code == 201
    other = TestClient(anon.app)
    r = signup(other, "DUP@example.com")
    assert r.status_code == 409 and r.json()["error"]["code"] == "email_taken"


def test_bad_sign_up_input_is_rejected(anon):
    assert signup(anon, password="short").status_code == 422
    assert signup(anon, "not-an-email").status_code == 422
    assert signup(anon, fullName="   ").status_code == 422
    assert signup(anon, phone="12345").status_code == 422
    assert signup(anon, phone="").status_code == 201  # the phone is optional


def test_plus_84_phone_numbers_are_stored_with_a_leading_zero_on_the_account(anon):
    assert signup(anon, phone="+84 912 345 678").json()["customer"]["phone"] == "0912345678"


def test_wrong_password_and_unknown_email_look_the_same(anon):
    signup(anon, "known@example.com")
    visitor = TestClient(anon.app)
    wrong = sign_in(visitor, "known@example.com", "wrong-password-1")
    unknown = sign_in(visitor, "nobody@example.com")
    assert wrong.status_code == unknown.status_code == 401
    assert wrong.json() == unknown.json()


def test_signing_in_works_and_signing_out_needs_the_csrf_token(anon):
    signup(anon, "again@example.com")
    visitor = TestClient(anon.app)
    assert sign_in(visitor, "again@example.com").status_code == 200
    bare = TestClient(visitor.app, cookies=visitor.cookies)  # same session, no CSRF header
    assert bare.post(f"{ACCOUNT}/logout").status_code == 403
    assert visitor.post(f"{ACCOUNT}/logout").status_code == 204
    assert visitor.get(f"{ACCOUNT}/me").json()["customer"] is None


def test_sign_in_is_rate_limited_after_repeated_failures(anon):
    signup(anon, "limit@example.com")
    visitor = TestClient(anon.app)
    for _ in range(5):
        assert sign_in(visitor, "limit@example.com", "wrong-password-1").status_code == 401
    r = sign_in(visitor, "limit@example.com")
    assert r.status_code == 429 and r.json()["error"]["code"] == "too_many_attempts"


def test_a_customer_is_not_staff_and_staff_are_not_customers(anon, signed_in):
    signup(anon, "plain@example.com")
    assert anon.get("/api/admin/orders").status_code == 401  # the shopper's cookie opens no back-office door
    staff = TestClient(signed_in.app)
    r = staff.post(
        f"{ACCOUNT}/login", json={"email": "admin@example.com", "password": "correct-horse-battery"}
    )
    assert r.status_code == 401  # an admin e-mail is not a customer account


def test_guessing_one_account_from_many_addresses_still_stops(anon, monkeypatch):
    from app.core.security import RateLimiter
    from app.modules.customers import router as customers_router

    signup(anon, "target@example.com")
    # Pretend every try comes from a different address: the per-address limiter never trips, the per-e-mail one must.
    monkeypatch.setattr(customers_router, "_login_limiter", RateLimiter(limit=1000, window_seconds=300))
    visitor = TestClient(anon.app)
    codes = [sign_in(visitor, "target@example.com", "wrong-password-1").status_code for _ in range(11)]
    assert codes[:10] == [401] * 10 and codes[10] == 429


def test_account_answers_are_never_cached(anon):
    signup(anon, "private@example.com")
    for path in (f"{ACCOUNT}/me", f"{ACCOUNT}/orders"):
        assert anon.get(path).headers["cache-control"] == "no-store"


# ================================================================== profile
def test_the_profile_needs_a_signed_in_customer_and_the_csrf_token(anon):
    payload = {
        "fullName": "Ai Đó",
        "phone": "",
        "shipAddress": "",
        "shipWard": "",
        "shipDistrict": "",
        "shipProvince": "",
    }
    assert anon.patch(f"{ACCOUNT}/profile", json=payload).status_code == 401
    signup(anon, "profile@example.com")
    assert anon.patch(f"{ACCOUNT}/profile", json=payload).status_code == 403


def test_saved_delivery_details_come_back_on_the_next_visit(anon):
    out = signup(anon, "saved@example.com").json()
    anon.headers["X-CSRF-Token"] = out["csrf"]
    r = anon.patch(
        f"{ACCOUNT}/profile",
        json={
            "fullName": "Lê Văn Cường",
            "phone": "0987654321",
            "shipAddress": "12 Lê Lợi",
            "shipWard": "Bến Nghé",
            "shipDistrict": "Quận 1",
            "shipProvince": "TP. Hồ Chí Minh",
        },
    )
    assert r.status_code == 200 and r.json()["shipDistrict"] == "Quận 1"
    again = TestClient(anon.app)
    sign_in(again, "saved@example.com")
    me = again.get(f"{ACCOUNT}/me").json()["customer"]
    assert (me["fullName"], me["phone"], me["shipAddress"]) == ("Lê Văn Cường", "0987654321", "12 Lê Lợi")


# ================================================================== checkout needs a login
def test_checkout_needs_a_signed_in_customer(signed_in, anon):
    p = sellable(signed_in)
    add(anon, p)
    r = anon.post(ORDERS, json=body(), headers={"Idempotency-Key": key()})
    assert r.status_code == 401 and r.json()["error"]["code"] == "login_required"
    assert anon.get("/api/cart").json()["itemCount"] == 1  # the cart is untouched, ready for after sign-in


def test_an_admin_session_cannot_place_a_shop_order(signed_in):
    p = sellable(signed_in)
    add(signed_in, p)
    r = signed_in.post(ORDERS, json=body(), headers={"Idempotency-Key": key()})
    assert r.status_code == 401 and r.json()["error"]["code"] == "login_required"


def test_checkout_needs_the_csrf_token_too(signed_in, anon):
    p = sellable(signed_in)
    add(anon, p)
    signup(anon, "csrf@example.com")
    r = anon.post(ORDERS, json=body(), headers={"Idempotency-Key": key()})
    assert r.status_code == 403 and r.json()["error"]["code"] == "csrf_invalid"


def test_the_cart_survives_signing_in_and_the_order_belongs_to_the_customer(signed_in, anon):
    p = sellable(signed_in)
    add(anon, p, 2)  # a visitor fills the cart first
    out = signup(anon, "owner@example.com").json()
    anon.headers["X-CSRF-Token"] = out["csrf"]
    assert anon.get("/api/cart").json()["itemCount"] == 2
    r = anon.post(ORDERS, json=body(), headers={"Idempotency-Key": key()})
    assert r.status_code == 201
    mine = anon.get(f"{ACCOUNT}/orders").json()
    assert [o["code"] for o in mine] == [r.json()["code"]]


def test_the_same_checkout_key_from_another_customer_is_refused(signed_in, anon):
    p = sellable(signed_in)
    add(anon, p)
    idem = key()
    assert place(anon, idem).status_code == 201
    other = TestClient(anon.app)
    add(other, p)
    r = place(other, idem)
    assert r.status_code == 409


# ================================================================== own orders only
def test_a_customer_sees_only_their_own_orders(signed_in, anon):
    p = sellable(signed_in)
    add(anon, p)
    first = place(anon)
    assert first.status_code == 201
    other = TestClient(anon.app)
    add(other, p)
    second = place(other)
    assert second.status_code == 201

    mine = anon.get(f"{ACCOUNT}/orders").json()
    assert [o["code"] for o in mine] == [first.json()["code"]]
    assert mine[0]["customerPhone"] == "0901234567"  # their own number, not masked

    assert anon.get(f"{ACCOUNT}/orders/{first.json()['code']}").status_code == 200
    stranger = anon.get(f"{ACCOUNT}/orders/{second.json()['code']}")
    assert stranger.status_code == 404 and stranger.json()["error"]["code"] == "order_not_found"


def test_the_order_list_needs_a_login(anon):
    r = anon.get(f"{ACCOUNT}/orders")
    assert r.status_code == 401 and r.json()["error"]["code"] == "login_required"
