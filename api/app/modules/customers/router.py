"""Customer sign-up, sign-in, e-mail links and profile. Staff sign in through /api/admin/auth; this is the shopper's own door."""

from __future__ import annotations

import secrets
from typing import Annotated

from fastapi import APIRouter, BackgroundTasks, Depends, Request, Response
from sqlalchemy.orm import Session

from app.core import mail
from app.core.config import Settings
from app.core.db import get_db
from app.core.errors import AppError
from app.core.security import RateLimiter
from app.modules.auth.deps import SESSION_CSRF, require_csrf

from . import service
from .deps import SESSION_CUSTOMER, current_customer, no_store, optional_customer
from .models import Customer
from .schemas import (
    AccountSession,
    ChangePasswordIn,
    CustomerOut,
    ForgotPasswordIn,
    LoginIn,
    OkOut,
    ProfileIn,
    RegisterIn,
    ResetPasswordIn,
    TokenIn,
)

router = APIRouter(prefix="/api/account", tags=["account"], dependencies=[Depends(no_store)])

# Slow down password guessing and bulk sign-ups from one address.
_login_limiter = RateLimiter(limit=5, window_seconds=300)
# Also counted per e-mail alone, so guessing one account from many addresses (or with a spoofed forwarding header) still stops.
# The price is that someone can briefly lock a known e-mail out; ten wrong tries in a quarter of an hour is the line.
_email_limiter = RateLimiter(limit=10, window_seconds=900)
_register_limiter = RateLimiter(limit=10, window_seconds=3600)
# Mail is the costly, abusable part: a person should not be able to flood someone's inbox through us.
_forgot_ip_limiter = RateLimiter(limit=5, window_seconds=3600)
_forgot_email_limiter = RateLimiter(limit=3, window_seconds=3600)
_link_limiter = RateLimiter(limit=20, window_seconds=3600)  # opening verify / reset links
_resend_limiter = RateLimiter(limit=3, window_seconds=3600)  # per customer
_password_limiter = RateLimiter(limit=5, window_seconds=900)  # changing a password, per customer

Db = Annotated[Session, Depends(get_db)]


def _ip(request: Request) -> str:
    return request.client.host if request.client else "?"


def _settings(request: Request) -> Settings:
    return request.app.state.settings


def _queue(background: BackgroundTasks, request: Request, message: service.Mail) -> None:
    background.add_task(
        mail.send_email, _settings(request), message.to, message.subject, message.text, message.html
    )


def _guard(limiter: RateLimiter, key: str, message: str = "Too many attempts. Try again later.") -> None:
    if limiter.blocked(key):
        raise AppError(429, "too_many_attempts", message)
    limiter.hit(key)


def _start_session(request: Request, customer: Customer) -> AccountSession:
    request.session.clear()  # a fresh session on sign-in prevents session fixation
    request.session[SESSION_CUSTOMER] = customer.id
    request.session[SESSION_CSRF] = secrets.token_urlsafe(24)
    return AccountSession(customer=CustomerOut.model_validate(customer), csrf=request.session[SESSION_CSRF])


@router.post("/register", response_model=AccountSession, status_code=201)
def register(body: RegisterIn, request: Request, db: Db, background: BackgroundTasks) -> AccountSession:
    _guard(_register_limiter, _ip(request), "Too many sign-ups. Try again later.")
    customer = service.register(db, body)
    _queue(background, request, service.verification_mail(db, _settings(request), customer))
    return _start_session(request, customer)


@router.post("/login", response_model=AccountSession)
def login(body: LoginIn, request: Request, db: Db) -> AccountSession:
    email = service.normalize_email(body.email)
    key = f"{_ip(request)}|{email}"
    if _login_limiter.blocked(key) or _email_limiter.blocked(email):
        raise AppError(429, "too_many_attempts", "Too many failed attempts. Try again in a few minutes.")
    customer = service.authenticate(db, body.email, body.password)
    if customer is None:
        _login_limiter.hit(key)
        _email_limiter.hit(email)
        raise AppError(401, "invalid_credentials", "Wrong e-mail or password.")
    _login_limiter.reset(key)
    _email_limiter.reset(email)
    return _start_session(request, customer)


@router.post("/logout", status_code=204, dependencies=[Depends(require_csrf)])
def logout(request: Request) -> Response:
    request.session.clear()
    return Response(status_code=204)


@router.get("/me", response_model=AccountSession)
def me(request: Request, customer: Annotated[Customer | None, Depends(optional_customer)]) -> AccountSession:
    """Never an error for a visitor: the page header asks this on every load and just wants to know who is there."""
    if customer is None:
        return AccountSession(customer=None, csrf=None)
    return AccountSession(
        customer=CustomerOut.model_validate(customer), csrf=request.session.get(SESSION_CSRF)
    )


@router.patch("/profile", response_model=CustomerOut)
def update_profile(
    body: ProfileIn,
    db: Db,
    customer: Annotated[Customer, Depends(current_customer)],
    _csrf: Annotated[None, Depends(require_csrf)],
) -> CustomerOut:
    return CustomerOut.model_validate(service.update_profile(db, customer, body))


# ------------------------------------------------------------------ e-mail links
@router.post("/forgot-password", response_model=OkOut, status_code=202)
def forgot_password(body: ForgotPasswordIn, request: Request, db: Db, background: BackgroundTasks) -> OkOut:
    """Always the same answer, whether or not the address has an account, and the mail goes out after the reply is sent."""
    _guard(_forgot_ip_limiter, _ip(request))
    _guard(_forgot_email_limiter, body.email)
    message = service.reset_mail(db, _settings(request), body.email)
    if message is not None:
        _queue(background, request, message)
    return OkOut()


@router.post("/reset-password", response_model=OkOut)
def reset_password(body: ResetPasswordIn, request: Request, db: Db) -> OkOut:
    _guard(_link_limiter, _ip(request))
    service.reset_password(db, body.token, body.password)
    return OkOut()


@router.post("/verify-email", response_model=OkOut)
def verify_email(body: TokenIn, request: Request, db: Db) -> OkOut:
    _guard(_link_limiter, _ip(request))
    service.verify_email(db, body.token)
    return OkOut()


@router.post("/resend-verification", response_model=OkOut, status_code=202)
def resend_verification(
    request: Request,
    db: Db,
    background: BackgroundTasks,
    customer: Annotated[Customer, Depends(current_customer)],
    _csrf: Annotated[None, Depends(require_csrf)],
) -> OkOut:
    if customer.email_verified:
        return OkOut()
    _guard(
        _resend_limiter,
        str(customer.id),
        "A link was sent a moment ago. Check your inbox, or try again in a while.",
    )
    _queue(background, request, service.verification_mail(db, _settings(request), customer))
    return OkOut()


@router.post("/change-password", response_model=OkOut)
def change_password(
    body: ChangePasswordIn,
    db: Db,
    customer: Annotated[Customer, Depends(current_customer)],
    _csrf: Annotated[None, Depends(require_csrf)],
) -> OkOut:
    _guard(_password_limiter, str(customer.id))
    service.change_password(db, customer, body.current_password, body.new_password)
    return OkOut()
