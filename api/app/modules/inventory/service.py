"""Reserve, ship and return stock for orders, and adjust it by hand.

Every change is one conditional UPDATE, so two customers buying the last unit at the same moment cannot both win (the
database decides, no application lock is needed). Each change also writes a StockMovement row. Release and ship work from
those rows, so an order can only give back what it actually took, however many times they are called.
"""

from __future__ import annotations

from sqlalchemy import func, or_, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.db import utcnow
from app.core.errors import AppError
from app.modules.auth.models import AdminUser
from app.modules.catalog.models import Product, Variant
from app.modules.orders.models import Order

from .models import StockLevel, StockMovement

LOW_STOCK_AT = 5


def _movement(
    db: Session, order: Order | None, variant_id: int, kind: str, d_on_hand: int, d_reserved: int, **kw
) -> None:
    db.add(
        StockMovement(
            variant_id=variant_id,
            kind=kind,
            delta_on_hand=d_on_hand,
            delta_reserved=d_reserved,
            order_id=order.id if order is not None else None,
            created_at=utcnow(),
            **kw,
        )
    )


# ------------------------------------------------------------------ what the shop can sell
def available_map(db: Session, variant_ids: list[int]) -> dict[int, int]:
    """Units still sellable per variant. A variant that is not tracked is absent from the result (= unlimited)."""
    if not variant_ids:
        return {}
    rows = db.execute(
        select(StockLevel.variant_id, StockLevel.on_hand - StockLevel.reserved).where(
            StockLevel.variant_id.in_(variant_ids)
        )
    ).all()
    return {vid: left for vid, left in rows}


# ------------------------------------------------------------------ order lifecycle
def reserve(db: Session, order: Order) -> None:
    """Hold the quantities of a new order. Raises 409 `out_of_stock` (and undoes everything) if any line is short."""
    db.flush()  # the order needs its id for the movement log
    short: list[str] = []
    for item in sorted(order.items, key=lambda i: i.variant_id):  # fixed order avoids deadlocks
        done = db.execute(
            update(StockLevel)
            .where(
                StockLevel.variant_id == item.variant_id, StockLevel.on_hand - StockLevel.reserved >= item.qty
            )
            .values(reserved=StockLevel.reserved + item.qty, updated_at=utcnow())
            .execution_options(synchronize_session=False)
        ).rowcount
        if done:
            _movement(db, order, item.variant_id, "reserve", 0, item.qty)
        elif db.get(StockLevel, item.variant_id) is not None:  # tracked but not enough left
            short.append(item.sku)
        # no row: not tracked, always sellable
    if short:
        db.rollback()
        raise AppError(
            409,
            "out_of_stock",
            "Some items are out of stock. Lower the quantity or remove them.",
            {"skus": short},
        )


def _net_by_variant(db: Session, order: Order) -> dict[int, dict[str, int]]:
    """For this order: units still reserved and units that left the stock room, per variant, from the log."""
    out: dict[int, dict[str, int]] = {}
    for m in db.scalars(select(StockMovement).where(StockMovement.order_id == order.id)):
        row = out.setdefault(m.variant_id, {"reserved": 0, "shipped": 0})
        row["reserved"] += m.delta_reserved
        if m.kind == "ship":
            row["shipped"] += -m.delta_on_hand
        elif m.kind == "return":
            row["shipped"] -= m.delta_on_hand
    return out


def ship(db: Session, order: Order) -> None:
    """The parcel leaves: reserved units stop being 'on hand'. Safe to call twice (the second call finds nothing)."""
    for variant_id, n in _net_by_variant(db, order).items():
        qty = n["reserved"]
        if qty <= 0:
            continue
        level = db.get(StockLevel, variant_id)
        # When Odoo owns the count, its own delivery lowers on_hand; lowering it here too would count the parcel twice.
        leaves = 0 if level is not None and level.source == "odoo" else qty
        db.execute(
            update(StockLevel)
            .where(StockLevel.variant_id == variant_id)
            .values(
                on_hand=StockLevel.on_hand - leaves, reserved=StockLevel.reserved - qty, updated_at=utcnow()
            )
            .execution_options(synchronize_session=False)
        )
        _movement(db, order, variant_id, "ship", -leaves, -qty)


def release(db: Session, order: Order) -> None:
    """The order is cancelled or expired: free what it holds, and take back what already shipped. Safe to repeat."""
    for variant_id, n in _net_by_variant(db, order).items():
        if n["reserved"] > 0:
            db.execute(
                update(StockLevel)
                .where(StockLevel.variant_id == variant_id)
                .values(reserved=StockLevel.reserved - n["reserved"], updated_at=utcnow())
                .execution_options(synchronize_session=False)
            )
            _movement(db, order, variant_id, "release", 0, -n["reserved"])
        if n["shipped"] > 0:
            db.execute(
                update(StockLevel)
                .where(StockLevel.variant_id == variant_id)
                .values(on_hand=StockLevel.on_hand + n["shipped"], updated_at=utcnow())
                .execution_options(synchronize_session=False)
            )
            _movement(db, order, variant_id, "return", n["shipped"], 0)


# ------------------------------------------------------------------ back office
def _variant(db: Session, variant_id: int) -> Variant:
    v = db.get(Variant, variant_id)
    if v is None:
        raise AppError(404, "variant_not_found", "Variant not found.")
    return v


def adjust(db: Session, variant_id: int, delta: int, kind: str, note: str, actor: AdminUser) -> StockLevel:
    """Add (receive) or correct (adjust) the physical count. Cannot drop below what open orders already hold."""
    _variant(db, variant_id)
    existing = db.get(StockLevel, variant_id)
    if existing is not None and existing.source == "odoo":
        raise AppError(
            409, "managed_by_odoo", "This count comes from Odoo. Change it in Odoo and sync again."
        )
    if existing is None:
        try:
            with db.begin_nested():
                db.add(StockLevel(variant_id=variant_id, on_hand=0, reserved=0, updated_at=utcnow()))
        except IntegrityError:  # someone else started tracking it in the same instant: use theirs
            pass
    done = db.execute(
        update(StockLevel)
        .where(StockLevel.variant_id == variant_id, StockLevel.on_hand + delta >= StockLevel.reserved)
        .values(on_hand=StockLevel.on_hand + delta, updated_at=utcnow())
        .execution_options(synchronize_session=False)
    ).rowcount
    if not done:
        raise AppError(
            409,
            "below_reserved",
            "Open orders already hold more than that. Cancel them or enter a higher number.",
        )
    _movement(db, None, variant_id, kind, delta, 0, actor_id=actor.id, note=note.strip())
    db.commit()
    db.expire_all()
    return db.get(StockLevel, variant_id)  # type: ignore[return-value]


def get_row(db: Session, variant_id: int) -> tuple[Variant, Product, StockLevel | None]:
    row = db.execute(
        select(Variant, Product, StockLevel)
        .join(Product, Product.id == Variant.product_id)
        .outerjoin(StockLevel, StockLevel.variant_id == Variant.id)
        .where(Variant.id == variant_id)
    ).one_or_none()
    if row is None:
        raise AppError(404, "variant_not_found", "Variant not found.")
    return row[0], row[1], row[2]


def list_levels(
    db: Session, q: str, state: str, page: int, page_size: int
) -> tuple[list[tuple[Variant, Product, StockLevel | None]], int]:
    left = StockLevel.on_hand - StockLevel.reserved
    stmt = (
        select(Variant, Product, StockLevel)
        .join(Product, Product.id == Variant.product_id)
        .outerjoin(StockLevel, StockLevel.variant_id == Variant.id)
    )
    if q.strip():
        like = f"%{q.strip()}%"
        stmt = stmt.where(or_(Variant.sku.ilike(like), Product.name.ilike(like)))
    if state == "untracked":
        stmt = stmt.where(StockLevel.variant_id.is_(None))
    elif state == "out":
        stmt = stmt.where(left <= 0)
    elif state == "low":
        stmt = stmt.where(left > 0, left <= LOW_STOCK_AT)
    total = db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    rows = db.execute(
        stmt.order_by(Product.name, Variant.sort_order, Variant.id)
        .offset((page - 1) * page_size)
        .limit(page_size)
    ).all()
    return [(v, p, s) for v, p, s in rows], total


def movements(
    db: Session, variant_id: int, limit: int = 50
) -> list[tuple[StockMovement, str | None, str | None]]:
    _variant(db, variant_id)
    rows = db.execute(
        select(StockMovement, AdminUser.email, Order.code)
        .outerjoin(AdminUser, AdminUser.id == StockMovement.actor_id)
        .outerjoin(Order, Order.id == StockMovement.order_id)
        .where(StockMovement.variant_id == variant_id)
        .order_by(StockMovement.id.desc())
        .limit(limit)
    ).all()
    return [(m, email, code) for m, email, code in rows]
