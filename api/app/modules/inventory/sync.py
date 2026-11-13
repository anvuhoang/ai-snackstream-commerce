"""Copy on-hand quantities from Odoo into our stock table, matched on SKU (Odoo's Internal Reference).

Odoo owns the physical count. Our side keeps what is promised to open orders (`reserved`). A run never writes to Odoo,
never deletes anything, and never sets a count below what open orders already hold (that would break an order that is
still to be shipped). A failed run leaves every number as it was and is recorded for the back office to show.
"""

from __future__ import annotations

from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.core.db import utcnow
from app.core.errors import AppError
from app.modules.catalog.models import Variant

from .models import StockLevel, StockMovement, StockSyncRun
from .odoo import OdooClient, OdooError


def last_run(db: Session) -> StockSyncRun | None:
    return db.scalar(select(StockSyncRun).order_by(StockSyncRun.id.desc()).limit(1))


def sync_from_odoo(db: Session, settings: Settings, client: OdooClient | None = None) -> StockSyncRun:
    if not settings.odoo_enabled:
        raise AppError(
            409, "odoo_not_configured", "Odoo is not configured (ODOO_URL, ODOO_DB, ODOO_API_KEY)."
        )
    run = StockSyncRun(started_at=utcnow())
    db.add(run)
    db.commit()

    own_client = client is None
    client = client or OdooClient(settings)
    try:
        variants = db.execute(select(Variant.id, Variant.sku)).all()
        try:
            found = client.stock_by_sku([sku for _, sku in variants])
        except OdooError as exc:
            run.error = str(exc)[:500]
            return _finish(db, run, ok=False)

        now = utcnow()
        for variant_id, sku in variants:
            odoo = found.get(sku)
            if odoo is None:
                continue
            run.matched += 1
            level = db.get(StockLevel, variant_id)
            if level is None:
                level = StockLevel(
                    variant_id=variant_id, on_hand=0, reserved=0, source="odoo", updated_at=now
                )
                db.add(level)
                db.flush()
            target = max(odoo.on_hand, level.reserved)
            before = level.on_hand
            moved = db.execute(
                update(StockLevel)
                .where(StockLevel.variant_id == variant_id, StockLevel.reserved <= target)
                .values(on_hand=target, source="odoo", synced_at=now, updated_at=now)
                .execution_options(synchronize_session=False)
            ).rowcount
            if moved and target != before:
                run.changed += 1
                db.add(
                    StockMovement(
                        variant_id=variant_id,
                        kind="sync",
                        delta_on_hand=target - before,
                        delta_reserved=0,
                        note=f"Odoo on hand: {odoo.on_hand}",
                        created_at=now,
                    )
                )
        run.missing_skus = ",".join(sku for _, sku in variants if sku not in found)
        return _finish(db, run, ok=True)
    finally:
        if own_client:
            client.close()


def _finish(db: Session, run: StockSyncRun, ok: bool) -> StockSyncRun:
    run.ok = ok
    run.finished_at = utcnow()
    db.commit()
    return run
