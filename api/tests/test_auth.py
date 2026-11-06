from app.core.security import hash_password, verify_password

from .conftest import ADMIN_EMAIL, ADMIN_PASSWORD

LOGIN = "/api/admin/auth/login"


def test_unauthenticated_request_gets_the_standard_error_shape(client):
    r = client.get("/api/admin/auth/me")
    assert r.status_code == 401
    assert r.json() == {"error": {"code": "not_authenticated", "message": "Please sign in."}}


def test_login_succeeds_and_returns_a_csrf_token(client):
    r = client.post(
        LOGIN, json={"email": "  Admin@Example.com ", "password": ADMIN_PASSWORD}
    )  # e-mail is normalized
    assert r.status_code == 200
    body = r.json()
    assert body["user"]["email"] == ADMIN_EMAIL and body["user"]["role"] == "admin"
    assert len(body["csrf"]) >= 20
    assert client.get("/api/admin/auth/me").json()["user"]["email"] == ADMIN_EMAIL


def test_wrong_password_and_unknown_user_look_identical(client):
    a = client.post(LOGIN, json={"email": ADMIN_EMAIL, "password": "nope"})
    b = client.post(LOGIN, json={"email": "ghost@example.com", "password": "nope"})
    assert a.status_code == b.status_code == 401
    assert a.json() == b.json()  # no user enumeration


def test_login_is_rate_limited_after_repeated_failures(client):
    for _ in range(5):
        assert client.post(LOGIN, json={"email": ADMIN_EMAIL, "password": "bad"}).status_code == 401
    r = client.post(LOGIN, json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD})
    assert r.status_code == 429 and r.json()["error"]["code"] == "too_many_attempts"


def test_logout_requires_csrf_and_ends_the_session(client):
    csrf = client.post(LOGIN, json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD}).json()["csrf"]
    assert client.post("/api/admin/auth/logout").status_code == 403  # no token
    assert client.post("/api/admin/auth/logout", headers={"X-CSRF-Token": "wrong"}).status_code == 403
    assert client.post("/api/admin/auth/logout", headers={"X-CSRF-Token": csrf}).status_code == 200
    assert client.get("/api/admin/auth/me").status_code == 401


def test_login_rotates_the_session(client):
    first = client.post(LOGIN, json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD}).json()["csrf"]
    second = client.post(LOGIN, json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD}).json()["csrf"]
    assert first != second


def test_password_hashing_round_trip():
    h = hash_password("s3cret-value")
    assert h.startswith("scrypt$") and "s3cret-value" not in h
    assert verify_password("s3cret-value", h)
    assert not verify_password("other", h)
    assert not verify_password("s3cret-value", "garbage")
    assert hash_password("s3cret-value") != h  # salted
