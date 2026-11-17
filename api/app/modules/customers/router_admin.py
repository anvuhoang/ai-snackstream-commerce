"""Back office: see the shop's customers and switch an account off. Staff may look; only an admin may switch accounts."""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.core.errors import AppError
from app.modules.auth.deps import require_csrf, require_role
from app.modules.orders.models import Order

from .models import Customer
from .schemas import ActiveIn, AdminCustomerPage, AdminCustomerRow

router = APIRouter(prefix="/api/admin/customers", tags=["admin-customers"])
Db = Annotated[Session, Depends(get_db)]


def _row(customer: Customer, orders: int) -> AdminCustomerRow:
    return AdminCustomerRow(
        id=customer.id,
        email=customer.email,
        full_name=customer.full_name,
        phone=customer.phone,
        is_active=customer.is_active,
        email_verified=customer.email_verified,
        created_at=customer.created_at,
        order_count=orders,
    )


@router.get("", response_model=AdminCustomerPage, dependencies=[Depends(require_role("admin", "staff"))])
def list_customers(
    db: Db,
    q: Annotated[str, Query(max_length=100)] = "",
    page: Annotated[int, Query(ge=1, le=10_000)] = 1,
    page_size: Annotated[int, Query(ge=1, le=100, alias="pageSize")] = 20,
) -> AdminCustomerPage:
    where = []
    term = q.strip().lower()
    if term:
        like = f"%{term.replace('%', '').replace('_', '')}%"
        where.append(
            or_(
                func.lower(Customer.email).like(like),
                func.lower(Customer.full_name).like(like),
                Customer.phone.like(like),
            )
        )
    total = db.scalar(select(func.count()).select_from(Customer).where(*where)) or 0
    counts = select(Order.customer_id, func.count(Order.id).label("n")).group_by(Order.customer_id).subquery()
    rows = db.execute(
        select(Customer, func.coalesce(counts.c.n, 0))
        .outerjoin(counts, counts.c.customer_id == Customer.id)
        .where(*where)
        .order_by(Customer.id.desc())
        .limit(page_size)
        .offset((page - 1) * page_size)
    ).all()
    return AdminCustomerPage(items=[_row(c, n) for c, n in rows], page=page, page_size=page_size, total=total)


@router.patch(
    "/{customer_id}",
    response_model=AdminCustomerRow,
    dependencies=[Depends(require_role("admin")), Depends(require_csrf)],
)
def set_active(customer_id: int, body: ActiveIn, db: Db) -> AdminCustomerRow:
    """Switching an account off stops it signing in and ends any session it already has; its orders stay as they are."""
    customer = db.get(Customer, customer_id)
    if customer is None:
        raise AppError(404, "customer_not_found", "Customer not found.")
    customer.is_active = body.is_active
    db.commit()
    orders = db.scalar(select(func.count(Order.id)).where(Order.customer_id == customer.id)) or 0
    return _row(customer, orders)
