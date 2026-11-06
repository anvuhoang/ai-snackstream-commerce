from __future__ import annotations

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.core.security import hash_password, verify_password

from .models import AdminUser

# Verified against when the e-mail is unknown, so "no such user" and "wrong password" take the same time.
_DUMMY_HASH = hash_password("not-a-real-password")


def normalize_email(email: str) -> str:
    return email.strip().lower()


def authenticate(db: Session, email: str, password: str) -> AdminUser | None:
    user = db.scalar(select(AdminUser).where(AdminUser.email == normalize_email(email)))
    ok = verify_password(password, user.password_hash if user else _DUMMY_HASH)
    return user if (user and ok and user.is_active) else None


def create_admin(db: Session, email: str, password: str, role: str = "admin") -> AdminUser:
    user = AdminUser(email=normalize_email(email), password_hash=hash_password(password), role=role)
    db.add(user)
    db.commit()
    return user


def ensure_bootstrap_admin(db: Session, settings: Settings) -> bool:
    """Dev convenience. Creates the configured admin only when the table is empty. Returns True if created."""
    if not (settings.bootstrap_admin_email and settings.bootstrap_admin_password):
        return False
    if db.scalar(select(func.count()).select_from(AdminUser)):
        return False
    create_admin(db, settings.bootstrap_admin_email, settings.bootstrap_admin_password)
    return True
