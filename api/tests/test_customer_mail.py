"""E-mail links (verify, reset), changing a password, switching accounts off, and the mail sender itself."""

from __future__ import annotations

import hashlib
import re
import secrets
from datetime import timedelta

import httpx
import pytest
from fastapi.testclient import TestClient
from pydantic import SecretStr
from sqlalchemy import select

from app.core import mail
from app.core.config import Settings
from app.core.db import utcnow
from app.main import create_app
from app.modules.customers.models import Customer, CustomerToken

from .test_customers import ACCOUNT, PASSWORD, sign_in, signup
from .test_orders import ORDERS, add, body, key, sellable

TOKEN = re.compile(r"token=([\w-]+)")


@pytest.fixture()
def outbox(monkeypatch) -> list[dict]:
    """Every message the app tries to send; nothing leaves the test."""
    sent: list[dict] = []

    def fake(settings, to, subject, text, html_body=None):
        sent.append({"to": to, "subject": subject, "text": text, "html": html_body})
        return True

    monkeypatch.setattr(mail, "send_email", fake)
    return sent


def token_in(message: dict) -> str:
    found = TOKEN.search(message["text"])
    assert found, message["text"]
    return found.group(1)


def customer_row(client: TestClient, email: str) -> Customer:
    with client.app.state.session_factory() as db:
        return db.scalar(select(Customer).where(Customer.email == email))


# ================================================================== verify e-mail
def test_signing_up_sends_a_verification_link_and_opening_it_verifies(anon, outbox):
    out = signup(anon, "verify@example.com").json()
    assert out["customer"]["emailVerified"] is False
    assert len(outbox) == 1 and outbox[0]["to"] == "verify@example.com"
    assert "/account/verify-email?token=" in outbox[0]["text"]

    token = token_in(outbox[0])
    assert anon.post(f"{ACCOUNT}/verify-email", json={"token": token}).status_code == 200
    assert anon.get(f"{ACCOUNT}/me").json()["customer"]["emailVerified"] is True


def test_a_verification_link_works_once_and_a_guess_does_not_work(anon, outbox):
    signup(anon, "once@example.com")
    token = token_in(outbox[0])
    assert anon.post(f"{ACCOUNT}/verify-email", json={"token": token}).status_code == 200
    again = anon.post(f"{ACCOUNT}/verify-email", json={"token": token})
    assert again.status_code == 400 and again.json()["error"]["code"] == "invalid_token"
    guess = anon.post(f"{ACCOUNT}/verify-email", json={"token": secrets.token_urlsafe(32)})
    assert (
        guess.status_code == 400 and guess.json() == again.json()
    )  # the same answer, so nothing can be probed


def test_only_the_hash_of_a_token_is_stored(anon, outbox):
    signup(anon, "hashed@example.com")
    token = token_in(outbox[0])
    with anon.app.state.session_factory() as db:
        stored = [t.token_hash for t in db.scalars(select(CustomerToken))]
    assert token not in stored and hashlib.sha256(token.encode()).hexdigest() in stored


def test_an_expired_link_is_refused(anon, outbox):
    signup(anon, "late@example.com")
    token = token_in(outbox[0])
    with anon.app.state.session_factory() as db:
        row = db.scalar(select(CustomerToken))
        row.expires_at = utcnow() - timedelta(minutes=1)
        db.commit()
    assert anon.post(f"{ACCOUNT}/verify-email", json={"token": token}).status_code == 400


def test_resending_the_link_needs_a_login_the_csrf_token_and_is_limited(anon, outbox):
    out = signup(anon, "resend@example.com").json()
    assert TestClient(anon.app).post(f"{ACCOUNT}/resend-verification").status_code == 401
    anon.headers["X-CSRF-Token"] = out["csrf"]
    assert anon.post(f"{ACCOUNT}/resend-verification").status_code == 202
    assert anon.post(f"{ACCOUNT}/resend-verification").status_code == 202
    assert anon.post(f"{ACCOUNT}/resend-verification").status_code == 202
    assert anon.post(f"{ACCOUNT}/resend-verification").status_code == 429
    assert len(outbox) == 1 + 3  # the sign-up mail and three resends
    # a newer link replaces the older one
    assert anon.post(f"{ACCOUNT}/verify-email", json={"token": token_in(outbox[0])}).status_code == 400
    assert anon.post(f"{ACCOUNT}/verify-email", json={"token": token_in(outbox[-1])}).status_code == 200


# ================================================================== checkout and verification
def test_checkout_waits_for_a_verified_e_mail_when_that_is_required(signed_in, settings, outbox):
    strict = TestClient(create_app(settings.model_copy(update={"require_email_verification": True})))
    with strict:
        p = sellable(signed_in)
        add(strict, p)
        out = signup(strict, "strict@example.com").json()
        strict.headers["X-CSRF-Token"] = out["csrf"]
        blocked = strict.post(ORDERS, json=body(), headers={"Idempotency-Key": key()})
        assert blocked.status_code == 403 and blocked.json()["error"]["code"] == "email_not_verified"
        assert strict.post(f"{ACCOUNT}/verify-email", json={"token": token_in(outbox[-1])}).status_code == 200
        assert strict.post(ORDERS, json=body(), headers={"Idempotency-Key": key()}).status_code == 201


# ================================================================== forgot / reset password
def test_forgot_password_answers_the_same_for_every_address_and_mails_only_real_ones(anon, outbox):
    signup(anon, "real@example.com")
    outbox.clear()
    visitor = TestClient(anon.app)
    known = visitor.post(f"{ACCOUNT}/forgot-password", json={"email": "Real@Example.com"})
    unknown = visitor.post(f"{ACCOUNT}/forgot-password", json={"email": "nobody@example.com"})
    assert known.status_code == unknown.status_code == 202 and known.json() == unknown.json()
    assert [m["to"] for m in outbox] == ["real@example.com"]
    assert "/account/reset-password?token=" in outbox[0]["text"]


def test_a_reset_link_sets_a_new_password_once(anon, outbox):
    signup(anon, "reset@example.com")
    outbox.clear()
    visitor = TestClient(anon.app)
    visitor.post(f"{ACCOUNT}/forgot-password", json={"email": "reset@example.com"})
    token = token_in(outbox[0])

    assert (
        visitor.post(
            f"{ACCOUNT}/reset-password", json={"token": token, "password": "brand-new-pass-1"}
        ).status_code
        == 200
    )
    assert sign_in(visitor, "reset@example.com", PASSWORD).status_code == 401  # the old one is gone
    assert sign_in(visitor, "reset@example.com", "brand-new-pass-1").status_code == 200
    reused = visitor.post(f"{ACCOUNT}/reset-password", json={"token": token, "password": "another-pass-22"})
    assert reused.status_code == 400 and reused.json()["error"]["code"] == "invalid_token"
    assert customer_row(anon, "reset@example.com").email_verified  # reading the mail proved the address


def test_a_weak_new_password_is_refused_and_the_link_survives(anon, outbox):
    signup(anon, "weak@example.com")
    outbox.clear()
    visitor = TestClient(anon.app)
    visitor.post(f"{ACCOUNT}/forgot-password", json={"email": "weak@example.com"})
    token = token_in(outbox[0])
    assert (
        visitor.post(f"{ACCOUNT}/reset-password", json={"token": token, "password": "short"}).status_code
        == 422
    )
    assert (
        visitor.post(
            f"{ACCOUNT}/reset-password", json={"token": token, "password": "long-enough-pass"}
        ).status_code
        == 200
    )


def test_a_second_reset_request_cancels_the_first_link(anon, outbox):
    signup(anon, "two@example.com")
    outbox.clear()
    visitor = TestClient(anon.app)
    visitor.post(f"{ACCOUNT}/forgot-password", json={"email": "two@example.com"})
    visitor.post(f"{ACCOUNT}/forgot-password", json={"email": "two@example.com"})
    first, second = token_in(outbox[0]), token_in(outbox[1])
    assert (
        visitor.post(
            f"{ACCOUNT}/reset-password", json={"token": first, "password": "long-enough-pass"}
        ).status_code
        == 400
    )
    assert (
        visitor.post(
            f"{ACCOUNT}/reset-password", json={"token": second, "password": "long-enough-pass"}
        ).status_code
        == 200
    )


def test_a_verification_link_cannot_reset_a_password(anon, outbox):
    signup(anon, "mix@example.com")
    token = token_in(outbox[0])  # a verify link
    r = TestClient(anon.app).post(
        f"{ACCOUNT}/reset-password", json={"token": token, "password": "long-enough-pass"}
    )
    assert r.status_code == 400


def test_forgot_password_is_limited_per_address_and_per_visitor(anon, outbox):
    signup(anon, "flood@example.com")
    outbox.clear()
    visitor = TestClient(anon.app)
    codes = [
        visitor.post(f"{ACCOUNT}/forgot-password", json={"email": "flood@example.com"}).status_code
        for _ in range(4)
    ]
    assert codes == [202, 202, 202, 429]
    assert len(outbox) == 3  # the fourth mail was never made


def test_a_switched_off_account_gets_no_reset_mail(signed_in, anon, outbox):
    out = signup(anon, "off@example.com").json()
    cid = out["customer"]["id"]
    signed_in.patch(f"/api/admin/customers/{cid}", json={"isActive": False})
    outbox.clear()
    TestClient(anon.app).post(f"{ACCOUNT}/forgot-password", json={"email": "off@example.com"})
    assert outbox == []


# ================================================================== change password
def test_changing_a_password_needs_the_current_one_and_the_csrf_token(anon):
    out = signup(anon, "change@example.com").json()
    payload = {"currentPassword": PASSWORD, "newPassword": "a-better-pass-9"}
    assert anon.post(f"{ACCOUNT}/change-password", json=payload).status_code == 403  # no CSRF header yet
    anon.headers["X-CSRF-Token"] = out["csrf"]
    wrong = anon.post(f"{ACCOUNT}/change-password", json={**payload, "currentPassword": "not-my-password"})
    assert wrong.status_code == 403 and wrong.json()["error"]["code"] == "wrong_password"
    assert anon.post(f"{ACCOUNT}/change-password", json=payload).status_code == 200
    other = TestClient(anon.app)
    assert sign_in(other, "change@example.com", PASSWORD).status_code == 401
    assert sign_in(other, "change@example.com", "a-better-pass-9").status_code == 200


def test_guessing_the_current_password_is_limited(anon):
    out = signup(anon, "guess@example.com").json()
    anon.headers["X-CSRF-Token"] = out["csrf"]
    payload = {"currentPassword": "wrong-guess-1", "newPassword": "a-better-pass-9"}
    codes = [anon.post(f"{ACCOUNT}/change-password", json=payload).status_code for _ in range(6)]
    assert codes == [403] * 5 + [429]


# ================================================================== stronger hashes
def test_an_old_cheap_hash_is_upgraded_at_the_next_sign_in(anon):
    signup(anon, "old@example.com")
    salt = secrets.token_bytes(16)
    old = f"scrypt$16384$8$1${salt.hex()}${hashlib.scrypt(PASSWORD.encode(), salt=salt, n=16384, r=8, p=1).hex()}"
    with anon.app.state.session_factory() as db:
        row = db.scalar(select(Customer).where(Customer.email == "old@example.com"))
        row.password_hash = old
        db.commit()
    assert sign_in(TestClient(anon.app), "old@example.com").status_code == 200
    assert customer_row(anon, "old@example.com").password_hash.startswith("scrypt$32768$8$2$")
    assert (
        sign_in(TestClient(anon.app), "old@example.com").status_code == 200
    )  # and still works after the upgrade


# ================================================================== back office
def test_the_customer_list_is_for_signed_in_staff_only(signed_in, anon):
    signup(anon, "listed@example.com", fullName="Lê Thị Danh Sách")
    assert TestClient(signed_in.app).get("/api/admin/customers").status_code == 401
    assert anon.get("/api/admin/customers").status_code == 401  # a shopper is not staff
    page = signed_in.get("/api/admin/customers").json()
    assert page["total"] >= 1 and page["items"][0]["email"] == "listed@example.com"
    assert page["items"][0]["orderCount"] == 0 and "passwordHash" not in str(page)
    assert signed_in.get("/api/admin/customers", params={"q": "danh sách"}).json()["total"] == 1
    assert signed_in.get("/api/admin/customers", params={"q": "zzzz"}).json()["total"] == 0


def test_switching_an_account_off_blocks_sign_in_and_ends_its_session(signed_in, anon):
    out = signup(anon, "banned@example.com").json()
    cid = out["customer"]["id"]
    assert anon.get(f"{ACCOUNT}/me").json()["customer"] is not None

    r = signed_in.patch(f"/api/admin/customers/{cid}", json={"isActive": False})
    assert r.status_code == 200 and r.json()["isActive"] is False
    assert anon.get(f"{ACCOUNT}/me").json()["customer"] is None  # the open session stopped working at once
    assert sign_in(TestClient(anon.app), "banned@example.com").status_code == 401

    signed_in.patch(f"/api/admin/customers/{cid}", json={"isActive": True})
    assert sign_in(TestClient(anon.app), "banned@example.com").status_code == 200


def test_only_an_admin_with_the_csrf_token_may_switch_accounts(signed_in, anon, settings):
    cid = signup(anon, "target2@example.com").json()["customer"]["id"]
    no_csrf = TestClient(signed_in.app, cookies=signed_in.cookies)
    assert no_csrf.patch(f"/api/admin/customers/{cid}", json={"isActive": False}).status_code == 403
    assert anon.patch(f"/api/admin/customers/{cid}", json={"isActive": False}).status_code == 401
    assert signed_in.patch("/api/admin/customers/99999", json={"isActive": False}).status_code == 404


# ================================================================== the mail sender
def test_without_a_key_nothing_is_sent_but_the_flow_still_works(settings, monkeypatch):
    def boom(*a, **k):
        raise AssertionError("no network call without a key")

    monkeypatch.setattr(httpx, "post", boom)
    assert mail.send_email(settings, "a@example.com", "Subject", "Body with a link") is True


def test_with_a_key_the_message_goes_to_resend(settings, monkeypatch):
    seen: dict = {}

    def fake_post(url, headers, json, timeout):
        seen.update(url=url, headers=headers, json=json)
        return httpx.Response(200, json={"id": "abc"})

    monkeypatch.setattr(httpx, "post", fake_post)
    keyed = settings.model_copy(update={"resend_api_key": SecretStr("re_test_key")})
    assert mail.send_email(keyed, "buyer@example.com", "Hello", "plain", "<p>html</p>") is True
    assert seen["url"] == "https://api.resend.com/emails"
    assert seen["headers"]["Authorization"] == "Bearer re_test_key"
    assert seen["json"]["to"] == ["buyer@example.com"] and seen["json"]["html"] == "<p>html</p>"


def test_a_mail_failure_is_reported_not_raised(settings, monkeypatch, caplog):
    keyed = settings.model_copy(update={"resend_api_key": SecretStr("re_test_key")})
    monkeypatch.setattr(httpx, "post", lambda *a, **k: httpx.Response(403, text="only your own address"))
    assert mail.send_email(keyed, "x@example.com", "S", "link-secret-body") is False

    def down(*a, **k):
        raise httpx.ConnectError("no route")

    monkeypatch.setattr(httpx, "post", down)
    assert mail.send_email(keyed, "x@example.com", "S", "link-secret-body") is False
    assert (
        "re_test_key" not in caplog.text and "link-secret-body" not in caplog.text
    )  # neither the key nor the link is logged


def test_signing_up_still_works_when_the_mail_service_is_down(anon, monkeypatch):
    monkeypatch.setattr(httpx, "post", lambda *a, **k: (_ for _ in ()).throw(httpx.ConnectError("down")))
    anon.app.state.settings = anon.app.state.settings.model_copy(
        update={"resend_api_key": SecretStr("re_test_key")}
    )
    assert signup(anon, "survives@example.com").status_code == 201


def test_settings_default_to_requiring_verification_only_when_mail_can_be_sent():
    off = Settings(_env_file=None, RESEND_API_KEY="")
    on = Settings(_env_file=None, RESEND_API_KEY="re_x")
    assert off.email_verification_required is False and on.email_verification_required is True
    assert (
        Settings(
            _env_file=None, RESEND_API_KEY="re_x", REQUIRE_EMAIL_VERIFICATION=False
        ).email_verification_required
        is False
    )
