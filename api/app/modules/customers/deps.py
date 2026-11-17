"""Who is the shopper? Reads the signed session cookie; never trusts anything the browser sends in a body."""

from __future__ import annotations

from fastapi import Depends, Request, Response
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.core.errors import AppError

from .models import Customer

SESSION_CUSTOMER = "customer_id"


def optional_customer(request: Request, db: Session = Depends(get_db)) -> Customer | None:
    customer_id = request.session.get(SESSION_CUSTOMER)
    customer = db.get(Customer, customer_id) if customer_id else None
    return customer if customer and customer.is_active else None


def current_customer(customer: Customer | None = Depends(optional_customer)) -> Customer:
    """Checkout and the account pages need a signed-in customer; browsing and the cart do not."""
    if customer is None:
        raise AppError(401, "login_required", "Please sign in to continue.")
    return customer


def no_store(response: Response) -> None:
    """Account answers hold a name, an address and orders: no browser or shared cache may keep them."""
    response.headers["Cache-Control"] = "no-store"
