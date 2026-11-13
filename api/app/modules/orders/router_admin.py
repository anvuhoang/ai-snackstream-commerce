"""Back-office orders. Reading needs an admin or staff user; changing an order's status also needs a CSRF token."""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.core.storage import MediaStorage, get_storage
from app.modules.auth.deps import current_admin, require_csrf, require_role
from app.modules.auth.models import AdminUser

from . import presenters, service
from .schemas import AdminOrder, AdminOrderPage, OrderStatus, StatusChange

router = APIRouter(prefix="/api/admin/orders", tags=["admin-orders"])

Reader = Depends(require_role("admin", "staff"))
# Staff run the orders day to day, so they may change status too (unlike the catalog, which only admins edit).
Operator = [Depends(require_role("admin", "staff")), Depends(require_csrf)]
Db = Annotated[Session, Depends(get_db)]
Storage = Annotated[MediaStorage, Depends(get_storage)]


@router.get("", response_model=AdminOrderPage, dependencies=[Reader])
def list_orders(
    db: Db,
    q: str = Query("", max_length=100, description="Order code, customer name or phone."),
    status: OrderStatus | None = None,
    page: int = Query(1, ge=1, le=10_000),
    page_size: int = Query(20, ge=1, le=100, alias="pageSize"),
) -> AdminOrderPage:
    items, total = service.list_orders(db, q, status or "", page, page_size)
    return AdminOrderPage(
        items=[presenters.admin_row(o) for o in items], page=page, page_size=page_size, total=total
    )


@router.get("/{order_id}", response_model=AdminOrder, dependencies=[Reader])
def get_order(order_id: int, db: Db, storage: Storage) -> AdminOrder:
    order = service.load_order(db, order_id)
    service.expire_if_due(db, order)
    return presenters.admin_order(service.load_order(db, order_id), db, storage)


@router.post("/{order_id}/status", response_model=AdminOrder, dependencies=Operator)
def change_status(
    order_id: int, body: StatusChange, db: Db, storage: Storage, actor: AdminUser = Depends(current_admin)
) -> AdminOrder:
    return presenters.admin_order(service.change_status(db, order_id, body.to, body.note, actor), db, storage)
