"""Business rules for carts, checkout, order processing and payments.

Rules worth remembering:
- Prices always come from the catalog at the moment of checkout, never from the client or from the cart.
- Placing an order is one transaction and is idempotent (same Idempotency-Key + same request = same order).
- Order status and payment status are separate; the gateway's server-to-server callback decides if an online payment succeeded.
- Stock is reserved when the order is placed and released exactly once when it is cancelled or expires (see stock.py).
"""

from __future__ import annotations

import hashlib
import json
import secrets
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from sqlalchemy import func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, selectinload

from app.core.config import Settings
from app.core.db import utcnow
from app.core.errors import AppError
from app.core.security import new_public_token
from app.modules.auth.models import AdminUser
from app.modules.catalog.models import Product, Variant

from . import stock, vnpay
from .models import (
    Cart,
    CartItem,
    IdempotencyKey,
    Order,
    OrderItem,
    OrderStatusHistory,
    Payment,
)
from .schemas import CheckoutIn

# What may follow each status. Completed and cancelled are final.
TRANSITIONS: dict[str, tuple[str, ...]] = {
    "new": ("confirmed", "cancelled"),
    "confirmed": ("shipping", "cancelled"),
    "shipping": ("completed", "cancelled"),
    "completed": (),
    "cancelled": (),
}

# Letters and digits without look-alikes (no 0/O, 1/I/L), so a code read over the phone is not misheard.
_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"


def aware(dt: datetime | None) -> datetime | None:
    """SQLite hands back naive datetimes; everything is stored in UTC."""
    if dt is not None and dt.tzinfo is None:
        return dt.replace(tzinfo=UTC)
    return dt


# ================================================================== cart
def find_cart(db: Session, token: str | None) -> Cart | None:
    if not token:
        return None
    return db.scalar(select(Cart).where(Cart.token == token).options(selectinload(Cart.items)))


def create_cart(db: Session) -> Cart:
    cart = Cart(token=new_public_token(24))
    db.add(cart)
    db.commit()
    return cart


@dataclass
class CartLineData:
    item: CartItem
    variant: Variant
    product: Product
    available: bool

    @property
    def line_total(self) -> int:
        return self.variant.price_vnd * self.item.qty if self.available else 0


def shipping_fee(subtotal: int, settings: Settings) -> int:
    if subtotal == 0 or subtotal >= settings.free_ship_from_vnd:
        return 0
    return settings.shipping_fee_vnd


def cart_lines(db: Session, cart: Cart | None) -> list[CartLineData]:
    if cart is None or not cart.items:
        return []
    variants = {
        v.id: v
        for v in db.scalars(
            select(Variant)
            .where(Variant.id.in_([i.variant_id for i in cart.items]))
            .options(selectinload(Variant.product).selectinload(Product.images))
        )
    }
    lines = []
    for item in cart.items:
        v = variants.get(item.variant_id)
        if v is None:  # cannot happen (variants are never deleted) but a stale cart must not crash the page
            continue
        lines.append(CartLineData(item, v, v.product, v.is_active and v.product.status == "published"))
    return lines


def _sellable_variant(db: Session, variant_id: int) -> Variant:
    v = db.scalar(select(Variant).where(Variant.id == variant_id).options(selectinload(Variant.product)))
    if v is None or not v.is_active or v.product.status != "published":
        raise AppError(404, "variant_unavailable", "This item is not available.")
    return v


def _touch(db: Session, cart: Cart) -> Cart:
    cart.updated_at = utcnow()
    db.commit()
    db.expire(cart)  # the items were changed through other objects; read them again
    return find_cart(db, cart.token) or cart


def add_to_cart(db: Session, cart: Cart, variant_id: int, qty: int) -> Cart:
    _sellable_variant(db, variant_id)
    existing = next((i for i in cart.items if i.variant_id == variant_id), None)
    if existing:
        existing.qty = min(99, existing.qty + qty)
    else:
        db.add(CartItem(cart_id=cart.id, variant_id=variant_id, qty=qty))
    try:
        return _touch(db, cart)
    except IntegrityError:  # two clicks at the same moment: the other one won, add on top of it
        db.rollback()
        fresh = find_cart(db, cart.token)
        assert fresh is not None
        return add_to_cart(db, fresh, variant_id, qty)


def set_cart_qty(db: Session, cart: Cart, variant_id: int, qty: int) -> Cart:
    item = next((i for i in cart.items if i.variant_id == variant_id), None)
    if item is None:
        raise AppError(404, "cart_item_not_found", "That item is not in your cart.")
    item.qty = qty
    return _touch(db, cart)


def remove_from_cart(db: Session, cart: Cart, variant_id: int) -> Cart:
    item = next((i for i in cart.items if i.variant_id == variant_id), None)
    if item is not None:
        cart.items.remove(item)
    return _touch(db, cart)


# ================================================================== checkout
def _new_code(db: Session) -> str:
    for _ in range(10):
        raw = "".join(secrets.choice(_CODE_ALPHABET) for _ in range(8))
        code = f"SS-{raw[:4]}-{raw[4:]}"
        if db.scalar(select(Order.id).where(Order.code == code)) is None:
            return code
    raise AppError(500, "code_generation_failed", "Could not create an order code, please try again.")


def normalize_code(code: str) -> str:
    return code.strip().upper().replace(" ", "")


def _request_hash(lines: list[CartLineData], body: CheckoutIn) -> str:
    payload = {
        "cart": sorted((ln.item.variant_id, ln.item.qty) for ln in lines),
        "body": body.model_dump(mode="json"),
    }
    return hashlib.sha256(json.dumps(payload, sort_keys=True).encode()).hexdigest()


def load_order(db: Session, order_id: int) -> Order:
    order = db.scalar(
        select(Order)
        .where(Order.id == order_id)
        .options(selectinload(Order.items), selectinload(Order.payments), selectinload(Order.history))
    )
    if order is None:
        raise AppError(404, "order_not_found", "Order not found.")
    return order


def _replay(db: Session, key: str, request_hash: str) -> Order | None:
    """The order created earlier with this key, if any. Same key with a different request is a client bug."""
    stored = db.scalar(select(IdempotencyKey).where(IdempotencyKey.key == key))
    if stored is None:
        return None
    if stored.request_hash != request_hash:
        raise AppError(
            409, "idempotency_key_reused", "That Idempotency-Key was already used for a different request."
        )
    return load_order(db, stored.order_id)


def place_order(
    db: Session, settings: Settings, cart: Cart | None, body: CheckoutIn, idempotency_key: str
) -> Order:
    lines = cart_lines(db, cart)
    if not lines:
        # A retry after success finds an empty cart: answer with the order that key already made.
        stored = db.scalar(select(IdempotencyKey).where(IdempotencyKey.key == idempotency_key))
        if stored is not None:
            return load_order(db, stored.order_id)
        raise AppError(409, "cart_empty", "Your cart is empty.")
    request_hash = _request_hash(lines, body)
    replayed = _replay(db, idempotency_key, request_hash)
    if replayed is not None:
        return replayed

    unavailable = [ln.variant.sku for ln in lines if not ln.available]
    if unavailable:
        raise AppError(
            409,
            "item_unavailable",
            "Some items are no longer available. Remove them and try again.",
            {"skus": unavailable},
        )
    if body.payment_method == "vnpay" and not settings.vnpay_enabled:
        raise AppError(422, "payment_method_unavailable", "Online payment is not available right now.")

    now = utcnow()
    subtotal = sum(ln.line_total for ln in lines)
    fee = shipping_fee(subtotal, settings)
    order = Order(
        code=_new_code(db),
        status="new",
        customer_name=body.customer.name,
        customer_phone=body.customer.phone,
        ship_address=body.shipping.address,
        ship_ward=body.shipping.ward.strip(),
        ship_district=body.shipping.district.strip(),
        ship_province=body.shipping.province.strip(),
        note=body.note.strip(),
        subtotal_vnd=subtotal,
        shipping_fee_vnd=fee,
        total_vnd=subtotal + fee,
        payment_method=body.payment_method,
        expires_at=now + timedelta(minutes=settings.order_expiry_minutes)
        if body.payment_method == "vnpay"
        else None,
    )
    for ln in lines:
        order.items.append(
            OrderItem(
                variant_id=ln.variant.id,
                sku=ln.variant.sku,
                product_name=ln.product.name,
                variant_name=ln.variant.name,
                unit_price_vnd=ln.variant.price_vnd,
                qty=ln.item.qty,
                line_total_vnd=ln.variant.price_vnd * ln.item.qty,
            )
        )
    order.history.append(
        OrderStatusHistory(
            from_status=None, to_status="new", actor_id=None, note="Order placed", created_at=now
        )
    )
    order.payments.append(Payment(provider=body.payment_method, status="pending", amount_vnd=order.total_vnd))
    db.add(order)
    stock.reserve(db, order)
    try:
        db.flush()
        db.add(
            IdempotencyKey(key=idempotency_key, request_hash=request_hash, order_id=order.id, created_at=now)
        )
        # The cart has done its job.
        for item in list(cart.items):  # type: ignore[union-attr]
            cart.items.remove(item)  # type: ignore[union-attr]
        db.commit()
    except IntegrityError:
        # The same key arrived twice at once and the other request won.
        db.rollback()
        replayed = _replay(db, idempotency_key, request_hash)
        if replayed is None:
            raise
        return replayed
    return load_order(db, order.id)


def payment_url(db: Session, settings: Settings, order: Order, ip: str) -> str | None:
    """The gateway address for an unpaid online order, built fresh each time (it carries a timestamp)."""
    if order.payment_method != "vnpay" or order.status == "cancelled":
        return None
    payment = next((p for p in order.payments if p.provider == "vnpay"), None)
    if payment is None or payment.status != "pending" or not settings.vnpay_enabled:
        return None
    return vnpay.build_payment_url(
        base_url=settings.vnpay_url,
        tmn_code=settings.vnpay_tmn_code,
        secret=settings.vnpay_hash_secret,
        return_url=settings.vnpay_return_url,
        ref=vnpay.txn_ref(order.id, payment.id),
        amount_vnd=order.total_vnd,
        order_code=order.code,
        ip=ip,
        now=utcnow(),
        expires_at=aware(order.expires_at),
    )


# ================================================================== look-up (customer)
def lookup_order(db: Session, code: str, phone: str) -> Order:
    """Both the code and the phone number must match; the same message for either mistake so neither can be probed."""
    order = db.scalar(select(Order).where(Order.code == normalize_code(code)))
    if order is None or order.customer_phone != phone:
        raise AppError(404, "order_not_found", "We could not find an order with that code and phone number.")
    expire_if_due(db, order)
    return load_order(db, order.id)


# ================================================================== back office
def _record(order: Order, to: str, actor: AdminUser | None, note: str, now: datetime) -> None:
    order.history.append(
        OrderStatusHistory(
            from_status=order.status,
            to_status=to,
            actor_id=actor.id if actor else None,
            note=note,
            created_at=now,
        )
    )
    order.status = to


def next_statuses(order: Order) -> list[str]:
    allowed = list(TRANSITIONS[order.status])
    if order.payment_method == "vnpay" and not any(p.status == "paid" for p in order.payments):
        allowed = [s for s in allowed if s not in ("confirmed", "shipping", "completed")]
    return allowed


def change_status(db: Session, order_id: int, to: str, note: str, actor: AdminUser) -> Order:
    order = load_order(db, order_id)
    expire_if_due(db, order)
    if to not in TRANSITIONS[order.status]:
        raise AppError(
            409,
            "invalid_transition",
            f"An order that is {order.status} cannot become {to}.",
            {"from": order.status, "to": to},
        )
    if to not in next_statuses(order):
        raise AppError(409, "payment_not_received", "The online payment has not been received yet.")
    now = utcnow()
    _record(order, to, actor, note.strip(), now)
    if to == "completed":
        # Cash on delivery is collected on the doorstep, so a completed COD order is a paid one.
        for p in order.payments:
            if p.provider == "cod" and p.status == "pending":
                p.status, p.paid_at = "paid", now
    if to == "cancelled":
        for p in order.payments:
            if p.status == "pending":
                p.status = "failed"
        order.expires_at = None
        stock.release(db, order)
    db.commit()
    return load_order(db, order.id)


def list_orders(db: Session, q: str, status: str, page: int, page_size: int) -> tuple[list[Order], int]:
    expire_due_orders(db)
    stmt = select(Order)
    if status:
        stmt = stmt.where(Order.status == status)
    if q.strip():
        like = f"%{q.strip()}%"
        stmt = stmt.where(
            or_(Order.code.ilike(like), Order.customer_name.ilike(like), Order.customer_phone.ilike(like))
        )
    total = db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    rows = db.scalars(
        stmt.order_by(Order.id.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
        .options(selectinload(Order.items), selectinload(Order.payments))
    ).all()
    return list(rows), total


# ================================================================== online payment
def expire_if_due(db: Session, order: Order) -> bool:
    """Cancel one unpaid online order whose time is up and give its stock back, once."""
    due = aware(order.expires_at)
    if order.status != "new" or due is None or due > utcnow():
        return False
    pending = [p for p in order.payments if p.status == "pending"]
    if not pending:
        return False
    for p in pending:
        p.status = "expired"
    _record(order, "cancelled", None, "Payment time ran out", utcnow())
    order.expires_at = None
    stock.release(db, order)
    db.commit()
    return True


def expire_due_orders(db: Session) -> int:
    """Housekeeping: run from the back office list, the CLI (`expire-orders`) or a scheduler."""
    now = utcnow()
    due = db.scalars(
        select(Order)
        .where(Order.status == "new", Order.expires_at.is_not(None), Order.expires_at < now)
        .options(selectinload(Order.payments), selectinload(Order.history), selectinload(Order.items))
    ).all()
    return sum(1 for o in due if expire_if_due(db, o))


def apply_vnpay_ipn(db: Session, settings: Settings, query: dict[str, str]) -> tuple[str, str]:
    """Handle the gateway's server-to-server callback. Returns VNPay's (RspCode, Message).

    Safe to receive twice: only a pending payment changes, and (provider, provider_ref) is unique.
    """
    if not settings.vnpay_enabled or not vnpay.verify(settings.vnpay_hash_secret, query):
        return "97", "Invalid signature"
    parsed = vnpay.parse_txn_ref(query.get("vnp_TxnRef", ""))
    payment = db.get(Payment, parsed[1]) if parsed else None
    if payment is None or parsed is None or payment.order_id != parsed[0] or payment.provider != "vnpay":
        return "01", "Order not found"
    order = load_order(db, payment.order_id)
    if query.get("vnp_Amount") != str(order.total_vnd * 100):
        return "04", "Invalid amount"
    if payment.status != "pending":
        return "02", "Order already confirmed"
    payment.last_payload = json.dumps(query, sort_keys=True)[:4000]
    if query.get("vnp_ResponseCode") == "00" and query.get("vnp_TransactionStatus", "00") == "00":
        payment.status, payment.paid_at = "paid", utcnow()
        payment.provider_ref = query.get("vnp_TransactionNo") or None
        order.expires_at = None
        order.history.append(
            OrderStatusHistory(
                from_status=order.status,
                to_status=order.status,
                actor_id=None,
                note="Paid online (VNPay)",
                created_at=utcnow(),
            )
        )
    else:
        payment.status = "failed"
    try:
        db.commit()
    except IntegrityError:  # the same transaction number was recorded by a parallel delivery
        db.rollback()
        return "02", "Order already confirmed"
    return "00", "Confirm Success"


def vnpay_return_result(db: Session, settings: Settings, query: dict[str, str]) -> tuple[str, str | None]:
    """What to tell the customer's browser. It only reads: the callback above is what changes anything."""
    if not settings.vnpay_enabled or not vnpay.verify(settings.vnpay_hash_secret, query):
        return "invalid", None
    parsed = vnpay.parse_txn_ref(query.get("vnp_TxnRef", ""))
    payment = db.get(Payment, parsed[1]) if parsed else None
    if payment is None or parsed is None or payment.order_id != parsed[0]:
        return "invalid", None
    order = db.get(Order, payment.order_id)
    code = order.code if order else None
    if payment.status == "paid":
        return "paid", code
    if payment.status in ("failed", "expired"):
        return "failed", code
    # Pending: the callback has not arrived yet (or it never will in local development).
    return ("failed", code) if query.get("vnp_ResponseCode", "00") != "00" else ("pending", code)
