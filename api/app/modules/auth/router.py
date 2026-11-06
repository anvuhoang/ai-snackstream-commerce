from __future__ import annotations

import secrets

from fastapi import APIRouter, Depends, Request
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.core.errors import AppError
from app.core.security import RateLimiter

from . import service
from .deps import SESSION_CSRF, SESSION_USER, current_admin, require_csrf
from .models import AdminUser
from .schemas import AdminOut, LoginIn, SessionOut

router = APIRouter(prefix="/api/admin/auth", tags=["admin-auth"])
_login_limiter = RateLimiter(limit=5, window_seconds=300)


def _session_out(request: Request, user: AdminUser) -> SessionOut:
    return SessionOut(user=AdminOut.model_validate(user), csrf=request.session[SESSION_CSRF])


@router.post("/login", response_model=SessionOut)
def login(body: LoginIn, request: Request, db: Session = Depends(get_db)) -> SessionOut:
    key = f"{request.client.host if request.client else '?'}|{service.normalize_email(body.email)}"
    if _login_limiter.blocked(key):
        raise AppError(429, "too_many_attempts", "Too many failed attempts. Try again in a few minutes.")
    user = service.authenticate(db, body.email, body.password)
    if not user:
        _login_limiter.hit(key)
        raise AppError(401, "invalid_credentials", "Wrong e-mail or password.")
    _login_limiter.reset(key)
    request.session.clear()  # fresh session on login (prevents session fixation)
    request.session[SESSION_USER] = user.id
    request.session[SESSION_CSRF] = secrets.token_urlsafe(24)
    return _session_out(request, user)


@router.post("/logout", dependencies=[Depends(require_csrf)])
def logout(request: Request) -> dict[str, bool]:
    request.session.clear()
    return {"ok": True}


@router.get("/me", response_model=SessionOut)
def me(request: Request, user: AdminUser = Depends(current_admin)) -> SessionOut:
    return _session_out(request, user)
