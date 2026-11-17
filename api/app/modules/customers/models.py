from __future__ import annotations

from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base, TimestampMixin, utcnow


class Customer(Base, TimestampMixin):
    """A shopper's account. Staff live in `admin_user`; the two never share a table or a role.

    The delivery details are what checkout pre-fills. Each order still copies its own snapshot, so changing
    them here never alters an order that was already placed.
    """

    __tablename__ = "customer"

    id: Mapped[int] = mapped_column(primary_key=True)
    email: Mapped[str] = mapped_column(String(254), unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(300))
    full_name: Mapped[str] = mapped_column(String(120))
    phone: Mapped[str] = mapped_column(String(15), default="")
    ship_address: Mapped[str] = mapped_column(String(255), default="")
    ship_ward: Mapped[str] = mapped_column(String(120), default="")
    ship_district: Mapped[str] = mapped_column(String(120), default="")
    ship_province: Mapped[str] = mapped_column(String(120), default="")
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    # Null until the customer opens the link we e-mailed. Whether checkout insists on it is a setting.
    email_verified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    @property
    def email_verified(self) -> bool:
        return self.email_verified_at is not None


class CustomerToken(Base):
    """A one-time link sent by e-mail: confirm an address (`verify`) or choose a new password (`reset`).

    Only the SHA-256 of the token is stored, so a copy of the database cannot be used to take over an account.
    """

    __tablename__ = "customer_token"

    id: Mapped[int] = mapped_column(primary_key=True)
    customer_id: Mapped[int] = mapped_column(ForeignKey("customer.id", ondelete="CASCADE"), index=True)
    kind: Mapped[str] = mapped_column(String(10))
    token_hash: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
