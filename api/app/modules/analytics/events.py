"""Writing events. Public events come from the browser, order events are written by the server inside the order's own
transaction, so an order and the event that says it happened are saved together or not at all.
"""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.db import utcnow
from app.core.errors import AppError
from app.modules.catalog.models import Product, Variant

from .models import Event
from .schemas import EventIn


def clean_source(value: str) -> str:
    """Sources are grouped by name, so `TikTok ` and `tiktok` must be the same row."""
    return value.strip().lower()[:100]


def record_public(db: Session, body: EventIn) -> bool:
    """Store one browser event. Returns False when it was a repeat of an event already stored (not an error)."""
    is_demo = body.is_demo
    if body.sku:
        row = db.execute(
            select(Product.is_demo)
            .join(Variant, Variant.product_id == Product.id)
            .where(Variant.sku == body.sku)
        ).first()
        if row is None:
            raise AppError(422, "invalid_sku", "Unknown SKU.")
        is_demo = bool(row[0])  # the product decides; the browser's claim is ignored
    else:
        # No product on this event (checkout_started, live_join, ...): it follows what the same session was last looking
        # at, so one visit is never split into a "real" half and a "demo" half. A session with no product yet uses the claim.
        last = db.scalar(
            select(Event.is_demo)
            .where(Event.session_id == body.session_id, Event.sku.is_not(None))
            .order_by(Event.id.desc())
            .limit(1)
        )
        if last is not None:
            is_demo = bool(last)
    event = Event(
        event_id=body.event_id,
        name=body.event,
        session_id=body.session_id,
        occurred_at=utcnow(),
        is_demo=is_demo,
        sku=body.sku or None,
        source=clean_source(body.source),
        campaign=body.campaign.strip()[:100],
        content_code=body.content_code.strip()[:100],
        surface=body.surface,
        qty=body.qty,
        cart_value_vnd=body.cart_value_vnd,
        live_id=body.live_id,
        conversation_id=body.conversation_id,
    )
    try:
        with db.begin_nested():
            db.add(event)
        db.commit()
    except IntegrityError:  # the same event_id again
        db.rollback()
        return False
    return True


def record_order_event(db: Session, name: str, order) -> None:
    """Add `order_created` / `order_completed` to the session, to be saved with the caller's commit.

    Safe to call twice for the same order and name: the second call finds the first and does nothing.
    """
    exists = db.scalar(select(Event.id).where(Event.name == name, Event.order_id == order.id))
    if exists is not None:
        return
    db.add(
        Event(
            name=name,
            session_id=order.session_id or f"order-{order.id}",
            occurred_at=utcnow(),
            is_demo=order.is_demo,
            source=order.utm_source,
            campaign=order.utm_campaign,
            content_code=order.utm_content,
            order_id=order.id,
        )
    )
