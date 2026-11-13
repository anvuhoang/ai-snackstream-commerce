"""The seam between orders and stock.

Order code only ever calls these three moments, as `stock.reserve(...)` / `stock.ship(...)` / `stock.release(...)`, so
tests can watch the calls and a second stock source (Odoo) can be added without touching the order flow. The work itself
lives in the inventory module.
"""

from __future__ import annotations

from sqlalchemy.orm import Session

from app.modules.inventory import service as inventory

from .models import Order


def reserve(db: Session, order: Order) -> None:
    """Hold the quantities of a new order. Raises 409 `out_of_stock` when a tracked item is short."""
    inventory.reserve(db, order)


def ship(db: Session, order: Order) -> None:
    """The order is on its way: the reserved units leave the stock room."""
    inventory.ship(db, order)


def release(db: Session, order: Order) -> None:
    """Called once, when the order is cancelled or expires: give back what it holds or already took."""
    inventory.release(db, order)
