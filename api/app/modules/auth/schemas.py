from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class LoginIn(BaseModel):
    email: str = Field(min_length=3, max_length=254)
    password: str = Field(min_length=1, max_length=200)


class AdminOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    email: str
    role: Literal["admin", "staff"]


class SessionOut(BaseModel):
    """What the web app needs after login: who, and the CSRF token to send on every write."""

    user: AdminOut
    csrf: str
