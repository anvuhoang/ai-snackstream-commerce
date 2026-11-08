"""Back-office stock. Staff run the stock room, so staff may change it too (CSRF token required for changes)."""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.modules.auth.deps import current_admin, require_csrf, require_role
from app.modules.auth.models import AdminUser

from . import service, sync
from .schemas import MovementOut, StockAdjust, StockPage, StockRow, StockState, SyncRunOut, SyncStatus

router = APIRouter(prefix="/api/admin/inventory", tags=["admin-inventory"])

Reader = Depends(require_role("admin", "staff"))
Operator = [Depends(require_role("admin", "staff")), Depends(require_csrf)]
Db = Annotated[Session, Depends(get_db)]


def _row(variant, product, level) -> StockRow:
    return StockRow(
        variant_id=variant.id,
        sku=variant.sku,
        product_name=product.name,
        variant_name=variant.name,
        tracked=level is not None,
        source=level.source if level else None,
        on_hand=level.on_hand if level else 0,
        reserved=level.reserved if level else 0,
        available=(level.on_hand - level.reserved) if level else 0,
        updated_at=level.updated_at if level else None,
        synced_at=level.synced_at if level else None,
    )


def _run(run) -> SyncRunOut | None:
    if run is None:
        return None
    return SyncRunOut(
        started_at=run.started_at,
        finished_at=run.finished_at,
        ok=run.ok,
        matched=run.matched,
        changed=run.changed,
        missing_skus=[s for s in run.missing_skus.split(",") if s],
        error=run.error,
    )


@router.get("", response_model=StockPage, dependencies=[Reader])
def list_stock(
    db: Db,
    q: str = Query("", max_length=100, description="SKU or product name."),
    state: StockState | None = None,
    page: int = Query(1, ge=1, le=10_000),
    page_size: int = Query(30, ge=1, le=100, alias="pageSize"),
) -> StockPage:
    rows, total = service.list_levels(db, q, state or "", page, page_size)
    return StockPage(
        items=[_row(*r) for r in rows],
        page=page,
        page_size=page_size,
        total=total,
        low_stock_at=service.LOW_STOCK_AT,
    )


@router.post("/{variant_id}/adjust", response_model=StockRow, dependencies=Operator)
def adjust(variant_id: int, body: StockAdjust, db: Db, actor: AdminUser = Depends(current_admin)) -> StockRow:
    service.adjust(db, variant_id, body.delta, body.kind, body.note, actor)
    return _row(*service.get_row(db, variant_id))


@router.get("/{variant_id}/movements", response_model=list[MovementOut], dependencies=[Reader])
def movements(variant_id: int, db: Db) -> list[MovementOut]:
    return [
        MovementOut(
            id=m.id,
            kind=m.kind,
            delta_on_hand=m.delta_on_hand,
            delta_reserved=m.delta_reserved,
            order_code=code,
            actor_email=email,
            note=m.note,
            created_at=m.created_at,
        )
        for m, email, code in service.movements(db, variant_id)
    ]


@router.get("/sync", response_model=SyncStatus, dependencies=[Reader])
def sync_status(request: Request, db: Db) -> SyncStatus:
    return SyncStatus(enabled=request.app.state.settings.odoo_enabled, last_run=_run(sync.last_run(db)))


@router.post("/sync", response_model=SyncStatus, dependencies=Operator)
def run_sync(request: Request, db: Db) -> SyncStatus:
    """Pull the on-hand counts from Odoo now. A failure is recorded in `lastRun`, not raised."""
    settings = request.app.state.settings
    return SyncStatus(enabled=True, last_run=_run(sync.sync_from_odoo(db, settings)))
