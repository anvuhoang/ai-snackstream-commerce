from __future__ import annotations

import secrets

from fastapi import HTTPException, Request

from . import analytics as A


def get_f(request: Request) -> A.Filters:
    return A.Filters.from_params(request.query_params)


def admin(request: Request) -> str:
    user = request.session.get("user")
    if not user:
        raise HTTPException(status_code=401, detail="Chưa đăng nhập")
    return user


def csrf_token(request: Request) -> str:
    tok = request.session.get("csrf")
    if not tok:
        tok = request.session["csrf"] = secrets.token_urlsafe(24)
    return tok


def require_csrf(request: Request) -> None:
    """Write operations in the admin area must send an X-CSRF-Token header matching the session."""
    sent = request.headers.get("x-csrf-token", "")
    if not sent or not secrets.compare_digest(sent, request.session.get("csrf", "")):
        raise HTTPException(status_code=403, detail="Phiên không hợp lệ (CSRF). Tải lại trang và thử lại.")
