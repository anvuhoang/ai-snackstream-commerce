"""Request and response models for customer accounts (camelCase on the wire)."""

from __future__ import annotations

import re
from datetime import datetime

from pydantic import Field, field_validator

from app.core.schemas import ApiModel
from app.core.text import normalize_phone

_EMAIL = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def _clean_email(value: str) -> str:
    value = value.strip().lower()
    if not _EMAIL.fullmatch(value):
        raise ValueError("Enter a valid e-mail address.")
    return value


class RegisterIn(ApiModel):
    email: str = Field(min_length=3, max_length=254)
    password: str = Field(min_length=8, max_length=200)
    full_name: str = Field(min_length=1, max_length=120)
    phone: str = Field("", max_length=30)

    @field_validator("email")
    @classmethod
    def _email(cls, v: str) -> str:
        return _clean_email(v)

    @field_validator("full_name")
    @classmethod
    def _name(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("Enter your name.")
        return v

    @field_validator("phone")
    @classmethod
    def _phone(cls, v: str) -> str:
        return normalize_phone(v) if v.strip() else ""


class LoginIn(ApiModel):
    email: str = Field(min_length=3, max_length=254)
    password: str = Field(min_length=1, max_length=200)


class ProfileIn(ApiModel):
    full_name: str = Field(min_length=1, max_length=120)
    phone: str = Field("", max_length=30)
    ship_address: str = Field("", max_length=255)
    ship_ward: str = Field("", max_length=120)
    ship_district: str = Field("", max_length=120)
    ship_province: str = Field("", max_length=120)

    @field_validator("full_name")
    @classmethod
    def _name(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("Enter your name.")
        return v

    @field_validator("phone")
    @classmethod
    def _phone(cls, v: str) -> str:
        return normalize_phone(v) if v.strip() else ""

    @field_validator("ship_address", "ship_ward", "ship_district", "ship_province")
    @classmethod
    def _trim(cls, v: str) -> str:
        return v.strip()


class CustomerOut(ApiModel):
    id: int
    email: str
    full_name: str
    phone: str
    ship_address: str
    ship_ward: str
    ship_district: str
    ship_province: str
    email_verified: bool


class ForgotPasswordIn(ApiModel):
    email: str = Field(min_length=3, max_length=254)

    @field_validator("email")
    @classmethod
    def _email(cls, v: str) -> str:
        return _clean_email(v)


class ResetPasswordIn(ApiModel):
    token: str = Field(min_length=20, max_length=200)
    password: str = Field(min_length=8, max_length=200)


class TokenIn(ApiModel):
    token: str = Field(min_length=20, max_length=200)


class ChangePasswordIn(ApiModel):
    current_password: str = Field(min_length=1, max_length=200)
    new_password: str = Field(min_length=8, max_length=200)


class OkOut(ApiModel):
    """The answer to requests that must not reveal whether an e-mail has an account."""

    ok: bool = True


class AccountSession(ApiModel):
    """Who is signed in (null for a visitor) and the CSRF token to send on every account write."""

    customer: CustomerOut | None
    csrf: str | None


# ------------------------------------------------------------------ back office
class AdminCustomerRow(ApiModel):
    id: int
    email: str
    full_name: str
    phone: str
    is_active: bool
    email_verified: bool
    created_at: datetime
    order_count: int


class AdminCustomerPage(ApiModel):
    items: list[AdminCustomerRow]
    page: int
    page_size: int
    total: int


class ActiveIn(ApiModel):
    is_active: bool
