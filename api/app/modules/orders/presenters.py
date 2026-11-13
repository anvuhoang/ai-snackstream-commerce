"""ORM objects -> response models."""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.core.storage import MediaStorage
from app.modules.auth.models import AdminUser
from app.modules.catalog import presenters as catalog_presenters
from app.modules.catalog.models import Product, Variant

from . import service
from .models import Order
from .schemas import (
    AdminOrder,
    AdminOrderRow,
    CartLine,
    CartOut,
    CheckoutOut,
    HistoryOut,
    OrderItemOut,
    OrderOut,
    PaymentOut,
)


def mask_phone(phone: str) -> str:
    """0901234567 -> 09******67"""
    return phone if len(phone) < 6 else f"{phone[:2]}{'*' * (len(phone) - 4)}{phone[-2:]}"


def _order_fields(o: Order, *, public: bool, actors: dict[int, str] | None = None) -> dict:
    actors = actors or {}
    return dict(
        code=o.code,
        status=o.status,
        customer_name=o.customer_name,
        customer_phone=mask_phone(o.customer_phone) if public else o.customer_phone,
        ship_address=o.ship_address,
        ship_ward=o.ship_ward,
        ship_district=o.ship_district,
        ship_province=o.ship_province,
        note=o.note,
        subtotal_vnd=o.subtotal_vnd,
        shipping_fee_vnd=o.shipping_fee_vnd,
        total_vnd=o.total_vnd,
        payment_method=o.payment_method,
        expires_at=o.expires_at,
        created_at=o.created_at,
        items=[OrderItemOut.model_validate(i) for i in o.items],
        payments=[PaymentOut.model_validate(p) for p in o.payments],
        history=[
            HistoryOut(
                from_status=h.from_status,
                to_status=h.to_status,
                note=h.note,
                created_at=h.created_at,
                actor_email=actors.get(h.actor_id) if (h.actor_id and not public) else None,
            )
            for h in o.history
        ],
    )


def public_order(o: Order) -> OrderOut:
    return OrderOut(**_order_fields(o, public=True))


def checkout_out(o: Order, payment_url: str | None) -> CheckoutOut:
    return CheckoutOut(**_order_fields(o, public=True), payment_url=payment_url)


def admin_order(o: Order, db: Session, storage: MediaStorage) -> AdminOrder:
    ids = {h.actor_id for h in o.history if h.actor_id}
    actors = (
        {u.id: u.email for u in db.scalars(select(AdminUser).where(AdminUser.id.in_(ids)))} if ids else {}
    )
    out = AdminOrder(
        id=o.id, next_statuses=service.next_statuses(o), **_order_fields(o, public=False, actors=actors)
    )
    # Photos come from today's catalog (the order itself keeps only a text snapshot).
    products = {
        sku: p
        for sku, p in db.execute(
            select(Variant.sku, Product)
            .join(Product, Product.id == Variant.product_id)
            .where(Variant.sku.in_([i.sku for i in o.items]))
            .options(selectinload(Product.images))
        )
    }
    for item in out.items:
        p = products.get(item.sku)
        item.image = catalog_presenters.image(p.images[0], storage) if p is not None and p.images else None
    return out


def admin_row(o: Order) -> AdminOrderRow:
    payment = o.payments[-1] if o.payments else None
    return AdminOrderRow(
        id=o.id,
        code=o.code,
        status=o.status,
        customer_name=o.customer_name,
        customer_phone=o.customer_phone,
        total_vnd=o.total_vnd,
        payment_method=o.payment_method,
        payment_status=payment.status if payment else None,
        item_count=sum(i.qty for i in o.items),
        created_at=o.created_at,
    )


def cart(lines: list[service.CartLineData], settings, storage: MediaStorage) -> CartOut:
    subtotal = sum(ln.line_total for ln in lines)
    fee = service.shipping_fee(subtotal, settings)
    out_lines = [
        CartLine(
            variant_id=ln.variant.id,
            sku=ln.variant.sku,
            product_slug=ln.product.slug,
            product_name=ln.product.name,
            variant_name=ln.variant.name,
            unit_price_vnd=ln.variant.price_vnd,
            qty=ln.item.qty,
            line_total_vnd=ln.line_total,
            image=catalog_presenters.image(ln.product.images[0], storage) if ln.product.images else None,
            available=ln.available,
        )
        for ln in lines
    ]
    remaining = (
        0
        if subtotal == 0 or subtotal >= settings.free_ship_from_vnd
        else settings.free_ship_from_vnd - subtotal
    )
    return CartOut(
        items=out_lines,
        item_count=sum(ln.item.qty for ln in lines if ln.available),
        subtotal_vnd=subtotal,
        shipping_fee_vnd=fee,
        total_vnd=subtotal + fee,
        free_ship_from_vnd=settings.free_ship_from_vnd,
        free_ship_remaining_vnd=remaining,
        has_unavailable=any(not ln.available for ln in lines),
    )
