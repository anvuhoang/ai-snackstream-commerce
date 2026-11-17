from __future__ import annotations

import hashlib
import secrets
from dataclasses import dataclass
from datetime import timedelta

from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.core.db import utcnow
from app.core.errors import AppError
from app.core.mail import render_action_email
from app.core.security import hash_password, needs_rehash, verify_password

from .models import Customer, CustomerToken
from .schemas import ProfileIn, RegisterIn

# Verified against when the e-mail is unknown, so "no such account" and "wrong password" take the same time.
_DUMMY_HASH = hash_password("not-a-real-password")

VERIFY_TTL = timedelta(hours=24)
RESET_TTL = timedelta(hours=1)


@dataclass(frozen=True)
class Mail:
    """A message ready to send. The router queues it after the response, so the reply never waits on the mail service."""

    to: str
    subject: str
    text: str
    html: str


def normalize_email(email: str) -> str:
    return email.strip().lower()


def authenticate(db: Session, email: str, password: str) -> Customer | None:
    customer = db.scalar(select(Customer).where(Customer.email == normalize_email(email)))
    ok = verify_password(password, customer.password_hash if customer else _DUMMY_HASH)
    if not (customer and ok and customer.is_active):
        return None
    if needs_rehash(customer.password_hash):
        # We hold the right password right now: the one moment a cheaper old hash can be replaced by a stronger one.
        customer.password_hash = hash_password(password)
        db.commit()
    return customer


def register(db: Session, data: RegisterIn) -> Customer:
    if db.scalar(select(Customer.id).where(Customer.email == data.email)) is not None:
        raise AppError(409, "email_taken", "An account with this e-mail already exists.")
    customer = Customer(
        email=data.email,
        password_hash=hash_password(data.password),
        full_name=data.full_name,
        phone=data.phone,
    )
    db.add(customer)
    try:
        db.commit()
    except IntegrityError:
        # Two sign-ups with the same e-mail at once: the unique index decides.
        db.rollback()
        raise AppError(409, "email_taken", "An account with this e-mail already exists.") from None
    return customer


def update_profile(db: Session, customer: Customer, data: ProfileIn) -> Customer:
    customer.full_name = data.full_name
    customer.phone = data.phone
    customer.ship_address = data.ship_address
    customer.ship_ward = data.ship_ward
    customer.ship_district = data.ship_district
    customer.ship_province = data.ship_province
    db.commit()
    return customer


# ------------------------------------------------------------------ one-time links sent by e-mail
def _hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def _issue_token(db: Session, customer: Customer, kind: str, ttl: timedelta) -> str:
    """A new link replaces any earlier unused one of the same kind. Only the hash is stored; the caller e-mails the raw token."""
    now = utcnow()
    db.execute(
        update(CustomerToken)
        .where(
            CustomerToken.customer_id == customer.id,
            CustomerToken.kind == kind,
            CustomerToken.used_at.is_(None),
        )
        .values(used_at=now)
    )
    raw = secrets.token_urlsafe(32)
    db.add(CustomerToken(customer_id=customer.id, kind=kind, token_hash=_hash(raw), expires_at=now + ttl))
    db.commit()
    return raw


def _take_token(db: Session, raw: str, kind: str) -> CustomerToken:
    """The matching, unused, unexpired token, marked used. Anything else is the same error, so nothing can be probed."""
    token = db.scalar(
        select(CustomerToken).where(CustomerToken.token_hash == _hash(raw), CustomerToken.kind == kind)
    )
    expires = token.expires_at if token else None
    if expires is not None and expires.tzinfo is None:  # SQLite hands back naive times
        expires = expires.replace(tzinfo=utcnow().tzinfo)
    if token is None or token.used_at is not None or expires is None or expires < utcnow():
        raise AppError(400, "invalid_token", "This link is invalid or has expired.")
    token.used_at = utcnow()
    return token


def verification_mail(db: Session, settings: Settings, customer: Customer) -> Mail:
    raw = _issue_token(db, customer, "verify", VERIFY_TTL)
    link = f"{settings.web_base_url.rstrip('/')}/account/verify-email?token={raw}"
    text, html = render_action_email(
        "Xác nhận địa chỉ e-mail",
        f"Chào {customer.full_name}, bấm nút dưới đây để xác nhận e-mail và hoàn tất tài khoản SnackStream của bạn.",
        "Xác nhận e-mail",
        link,
        "Đường dẫn có hiệu lực 24 giờ. Nếu bạn không đăng ký tài khoản này, cứ bỏ qua thư.",
    )
    return Mail(customer.email, "Xác nhận e-mail SnackStream", text, html)


def verify_email(db: Session, raw: str) -> Customer:
    token = _take_token(db, raw, "verify")
    customer = db.get(Customer, token.customer_id)
    if customer is None:  # cannot happen (cascade), but never trust a lookup
        raise AppError(400, "invalid_token", "This link is invalid or has expired.")
    if customer.email_verified_at is None:
        customer.email_verified_at = utcnow()
    db.commit()
    return customer


def reset_mail(db: Session, settings: Settings, email: str) -> Mail | None:
    """A mail for this address, or None when there is no active account. The caller answers the same way either way."""
    customer = db.scalar(select(Customer).where(Customer.email == normalize_email(email)))
    if customer is None or not customer.is_active:
        return None
    raw = _issue_token(db, customer, "reset", RESET_TTL)
    link = f"{settings.web_base_url.rstrip('/')}/account/reset-password?token={raw}"
    text, html = render_action_email(
        "Đặt lại mật khẩu",
        f"Chào {customer.full_name}, chúng tôi nhận được yêu cầu đặt lại mật khẩu cho tài khoản này. Bấm nút dưới đây để chọn mật khẩu mới.",
        "Đặt lại mật khẩu",
        link,
        "Đường dẫn có hiệu lực 1 giờ và chỉ dùng được một lần. Nếu không phải bạn yêu cầu, hãy bỏ qua thư này, mật khẩu của bạn không đổi.",
    )
    return Mail(customer.email, "Đặt lại mật khẩu SnackStream", text, html)


def reset_password(db: Session, raw: str, new_password: str) -> Customer:
    token = _take_token(db, raw, "reset")
    customer = db.get(Customer, token.customer_id)
    if customer is None or not customer.is_active:
        raise AppError(400, "invalid_token", "This link is invalid or has expired.")
    customer.password_hash = hash_password(new_password)
    if customer.email_verified_at is None:
        customer.email_verified_at = utcnow()  # they just proved they read this inbox
    db.commit()
    return customer


def change_password(db: Session, customer: Customer, current: str, new: str) -> None:
    if not verify_password(current, customer.password_hash):
        raise AppError(403, "wrong_password", "The current password is not correct.")
    customer.password_hash = hash_password(new)
    db.commit()
