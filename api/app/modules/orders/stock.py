"""The seam where stock goes in Phase 3.

P2 only needs two moments to exist: stock is reserved when an order is placed and released exactly once when it is cancelled
or expires. Phase 3 replaces these two functions (own tables and/or Odoo) without touching the order code, which always
calls them as `stock.reserve(...)` / `stock.release(...)` so tests can watch the calls.
"""

from __future__ import annotations

from sqlalchemy.orm import Session

from .models import Order


def reserve(db: Session, order: Order) -> None:
    """Hold the quantities of `order` for the customer. No-op until P3."""


def release(db: Session, order: Order) -> None:
    """Give the quantities of `order` back. Called once, when the order is cancelled or expires. No-op until P3."""
