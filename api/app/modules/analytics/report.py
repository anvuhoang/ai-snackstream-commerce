"""The dashboard numbers. Every formula and every "cannot be computed" rule lives here, so the screen, exports and tests
share one definition.

Rules that are easy to get wrong, and are fixed here:
- Views are counted as distinct *sessions*, never summed into "people": one person on two devices is two sessions.
- A funnel step counts sessions (view, cart, checkout) or orders (created, completed). The two units are never mixed.
- `order_created` and `order_completed` are separate steps. Revenue counts completed orders only.
- A ratio with a zero or missing denominator is `None`, never 0 and never 100%.
- A step with no data while later steps have data is flagged as a tracking gap; the funnel is not bridged over it.
- A click on "buy on Shopee" is counted on its own and is never an order.
- Periods are Vietnam calendar days (UTC+7, no daylight saving).
"""

from __future__ import annotations

from datetime import UTC, date, datetime, time, timedelta, timezone

from sqlalchemy import Select, distinct, func, select
from sqlalchemy.orm import Session

from app.modules.catalog.models import Product, Variant
from app.modules.orders.models import Order

from .models import Event
from .schemas import FunnelStep, Overview, ProductRow, SourceRow, Totals

VN = timezone(timedelta(hours=7))
STEPS: list[tuple[str, str]] = [
    ("product_view", "sessions"),
    ("add_to_cart", "sessions"),
    ("checkout_started", "sessions"),
    ("order_created", "orders"),
    ("order_completed", "orders"),
]
TOP_PRODUCTS = 10


def vn_today() -> date:
    return datetime.now(VN).date()


def day_bounds(date_from: date, date_to: date) -> tuple[datetime, datetime]:
    """[start, end) in UTC for the Vietnam days date_from..date_to inclusive."""
    start = datetime.combine(date_from, time.min, VN).astimezone(UTC)
    end = datetime.combine(date_to + timedelta(days=1), time.min, VN).astimezone(UTC)
    return start, end


def rate(num: int, den: int) -> float | None:
    """num / den as a fraction, or None when it cannot be computed (never a fake 0)."""
    return None if den <= 0 else num / den


def _scope(stmt: Select, start: datetime, end: datetime, demo: str, source: str | None) -> Select:
    stmt = stmt.where(Event.occurred_at >= start, Event.occurred_at < end)
    if demo == "exclude":
        stmt = stmt.where(Event.is_demo.is_(False))
    elif demo == "only":
        stmt = stmt.where(Event.is_demo.is_(True))
    if source is not None:
        stmt = stmt.where(Event.source == ("" if source == "direct" else source))
    return stmt


def overview(db: Session, date_from: date, date_to: date, demo: str, source: str | None) -> Overview:
    start, end = day_bounds(date_from, date_to)

    # ---- funnel
    counts: dict[str, int] = {}
    for name, unit in STEPS:
        col = Event.session_id if unit == "sessions" else Event.order_id
        stmt = _scope(select(func.count(distinct(col))).where(Event.name == name), start, end, demo, source)
        counts[name] = db.scalar(stmt) or 0
    funnel: list[FunnelStep] = []
    for i, (name, unit) in enumerate(STEPS):
        later_has_data = any(counts[n] > 0 for n, _ in STEPS[i + 1 :])
        if i == 0:
            note, value = "first_step", None
        elif counts[STEPS[i - 1][0]] == 0:
            note, value = "previous_step_empty", None
        else:
            note, value = "ok", rate(counts[name], counts[STEPS[i - 1][0]])
        funnel.append(
            FunnelStep(
                key=name,  # type: ignore[arg-type]
                unit=unit,  # type: ignore[arg-type]
                count=counts[name],
                rate=value,
                rate_note=note,  # type: ignore[arg-type]
                tracking_gap=counts[name] == 0 and later_has_data,
            )
        )

    # ---- revenue: orders that were completed in the period (joined to the order for its amount)
    rev = _scope(
        select(func.coalesce(func.sum(Order.total_vnd), 0))
        .select_from(Event)
        .join(Order, Order.id == Event.order_id),
        start,
        end,
        demo,
        source,
    ).where(Event.name == "order_completed")
    revenue = int(db.scalar(rev) or 0)
    created, completed = counts["order_created"], counts["order_completed"]
    totals = Totals(
        orders_created=created,
        orders_completed=completed,
        revenue_vnd=revenue,
        average_order_vnd=None if completed == 0 else round(revenue / completed),
        completion_rate=rate(completed, created),
    )

    # ---- by source: each order carries one source, so no order appears in two rows
    src_rows: dict[str, dict[str, int]] = {}

    def bucket(src: str) -> dict[str, int]:
        return src_rows.setdefault(
            src, {"viewers": 0, "carters": 0, "created": 0, "completed": 0, "revenue": 0}
        )

    grouped = _scope(
        select(
            Event.source,
            Event.name,
            func.count(distinct(Event.session_id)),
            func.count(distinct(Event.order_id)),
        ),
        start,
        end,
        demo,
        source,
    ).group_by(Event.source, Event.name)
    for src, name, sessions, orders in db.execute(grouped):
        b = bucket(src)
        if name == "product_view":
            b["viewers"] = sessions
        elif name == "add_to_cart":
            b["carters"] = sessions
        elif name == "order_created":
            b["created"] = orders
        elif name == "order_completed":
            b["completed"] = orders
    money = (
        _scope(
            select(Event.source, func.coalesce(func.sum(Order.total_vnd), 0))
            .select_from(Event)
            .join(Order, Order.id == Event.order_id),
            start,
            end,
            demo,
            source,
        )
        .where(Event.name == "order_completed")
        .group_by(Event.source)
    )
    for src, amount in db.execute(money):
        bucket(src)["revenue"] = int(amount)
    by_source = sorted(
        (
            SourceRow(
                source=s,
                viewers=v["viewers"],
                carters=v["carters"],
                orders_created=v["created"],
                orders_completed=v["completed"],
                revenue_vnd=v["revenue"],
            )
            for s, v in src_rows.items()
        ),
        key=lambda r: (-r.revenue_vnd, -r.orders_created, -r.viewers, r.source),
    )

    # ---- products
    per_sku: dict[str, dict[str, int]] = {}
    sku_stmt = _scope(
        select(Event.sku, Event.name, func.count(distinct(Event.session_id)), func.count(Event.id)).where(
            Event.sku.is_not(None), Event.name.in_(("product_view", "add_to_cart", "shopee_click"))
        ),
        start,
        end,
        demo,
        source,
    ).group_by(Event.sku, Event.name)
    for sku, name, sessions, clicks in db.execute(sku_stmt):
        row = per_sku.setdefault(sku, {"viewers": 0, "carters": 0, "shopee": 0})
        if name == "product_view":
            row["viewers"] = sessions
        elif name == "add_to_cart":
            row["carters"] = sessions
        else:
            row["shopee"] = clicks
    ranked = sorted(per_sku.items(), key=lambda kv: (-kv[1]["viewers"], -kv[1]["carters"], kv[0]))[
        :TOP_PRODUCTS
    ]
    names = {}
    if ranked:
        names = {
            sku: (pname, vname)
            for sku, pname, vname in db.execute(
                select(Variant.sku, Product.name, Variant.name)
                .join(Product, Product.id == Variant.product_id)
                .where(Variant.sku.in_([s for s, _ in ranked]))
            )
        }
    top = [
        ProductRow(
            sku=sku,
            product_name=names.get(sku, ("", ""))[0],
            variant_name=names.get(sku, ("", ""))[1],
            viewers=v["viewers"],
            carters=v["carters"],
            shopee_clicks=v["shopee"],
        )
        for sku, v in ranked
    ]

    shopee = db.scalar(
        _scope(select(func.count(Event.id)).where(Event.name == "shopee_click"), start, end, demo, source)
    )
    return Overview(
        date_from=date_from,
        date_to=date_to,
        demo=demo,  # type: ignore[arg-type]
        source=source,
        funnel=funnel,
        totals=totals,
        by_source=by_source,
        top_products=top,
        shopee_clicks=int(shopee or 0),
    )
