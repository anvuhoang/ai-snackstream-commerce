"""Auth dependencies shared by every admin router: who is calling, with which role, and CSRF."""

from __future__ import annotations

import secrets
from collections.abc import Callable

from fastapi import Depends, Request
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.core.errors import AppError

from .models import AdminUser

SESSION_USER = "admin_id"
SESSION_CSRF = "csrf"


def current_admin(request: Request, db: Session = Depends(get_db)) -> AdminUser:
    user_id = request.session.get(SESSION_USER)
    user = db.get(AdminUser, user_id) if user_id else None
    if not user or not user.is_active:
        raise AppError(401, "not_authenticated", "Please sign in.")
    return user


def require_role(*roles: str) -> Callable[..., AdminUser]:
    def dep(user: AdminUser = Depends(current_admin)) -> AdminUser:
        if user.role not in roles:
            raise AppError(403, "forbidden", "You do not have permission to do this.")
        return user

    return dep


def require_csrf(request: Request) -> None:
    """Every state-changing admin request must echo the session's CSRF token in X-CSRF-Token."""
    sent = request.headers.get("x-csrf-token", "")
    expected = request.session.get(SESSION_CSRF, "")
    if not sent or not expected or not secrets.compare_digest(sent, expected):
        raise AppError(403, "csrf_invalid", "Session expired. Reload the page and try again.")
