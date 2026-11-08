"""Public shop endpoints: cart, checkout, order look-up and the online-payment callbacks. No login: guests only."""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, Header, Request, Response
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.core.db import get_db
from app.core.errors import AppError
from app.core.security import RateLimiter
from app.core.storage import MediaStorage, get_storage

from . import presenters, service
from .models import Cart
from .schemas import (
    CartItemAdd,
    CartItemSet,
    CartOut,
    CheckoutIn,
    CheckoutOut,
    LookupIn,
    OrderOut,
    PaymentReturnOut,
    ShopConfig,
)

router = APIRouter(prefix="/api", tags=["shop"])

CART_COOKIE = "ss_cart"
CART_MAX_AGE = 60 * 60 * 24 * 30
# Looking an order up needs a code and a phone number; slow down anyone trying many guesses.
_lookup_limiter = RateLimiter(limit=10, window_seconds=60)

Db = Annotated[Session, Depends(get_db)]
Storage = Annotated[MediaStorage, Depends(get_storage)]


def _settings(request: Request) -> Settings:
    return request.app.state.settings


def _client_ip(request: Request) -> str:
    forwarded = request.headers.get("x-forwarded-for", "")
    return forwarded.split(",")[0].strip() or (request.client.host if request.client else "")


def _set_cookie(request: Request, response: Response, token: str) -> None:
    response.set_cookie(
        CART_COOKIE,
        token,
        max_age=CART_MAX_AGE,
        httponly=True,
        samesite="lax",
        secure=_settings(request).is_prod,
        path="/",
    )


def _cart_or_new(request: Request, response: Response, db: Session) -> Cart:
    """The visitor's cart; a first-time visitor gets an empty one and the cookie that points at it."""
    cart = service.find_cart(db, request.cookies.get(CART_COOKIE))
    if cart is None:
        cart = service.create_cart(db)
        _set_cookie(request, response, cart.token)
    return cart


def _cart_out(db: Session, cart: Cart | None, request: Request, storage: MediaStorage) -> CartOut:
    return presenters.cart(service.cart_lines(db, cart), _settings(request), storage)


# ------------------------------------------------------------------ shop settings
@router.get("/shop/config", response_model=ShopConfig)
def shop_config(request: Request) -> ShopConfig:
    s = _settings(request)
    return ShopConfig(
        shipping_fee_vnd=s.shipping_fee_vnd,
        free_ship_from_vnd=s.free_ship_from_vnd,
        payment_methods=["cod", "vnpay"] if s.vnpay_enabled else ["cod"],
        online_payment_is_sandbox=True,
        order_expiry_minutes=s.order_expiry_minutes,
    )


# ------------------------------------------------------------------ cart
@router.get("/cart", response_model=CartOut)
def get_cart(request: Request, db: Db, storage: Storage) -> CartOut:
    return _cart_out(db, service.find_cart(db, request.cookies.get(CART_COOKIE)), request, storage)


@router.post("/cart/items", response_model=CartOut)
def add_item(body: CartItemAdd, request: Request, response: Response, db: Db, storage: Storage) -> CartOut:
    cart = _cart_or_new(request, response, db)
    return _cart_out(db, service.add_to_cart(db, cart, body.variant_id, body.qty), request, storage)


@router.patch("/cart/items/{variant_id}", response_model=CartOut)
def set_item_qty(variant_id: int, body: CartItemSet, request: Request, db: Db, storage: Storage) -> CartOut:
    cart = service.find_cart(db, request.cookies.get(CART_COOKIE))
    if cart is None:
        raise AppError(404, "cart_item_not_found", "That item is not in your cart.")
    return _cart_out(db, service.set_cart_qty(db, cart, variant_id, body.qty), request, storage)


@router.delete("/cart/items/{variant_id}", response_model=CartOut)
def remove_item(variant_id: int, request: Request, db: Db, storage: Storage) -> CartOut:
    cart = service.find_cart(db, request.cookies.get(CART_COOKIE))
    if cart is None:
        return _cart_out(db, None, request, storage)
    return _cart_out(db, service.remove_from_cart(db, cart, variant_id), request, storage)


# ------------------------------------------------------------------ checkout and look-up
@router.post("/orders", response_model=CheckoutOut, status_code=201)
def checkout(
    body: CheckoutIn,
    request: Request,
    db: Db,
    idempotency_key: Annotated[
        str, Header(min_length=8, max_length=80, description="A fresh random value per checkout attempt.")
    ],
) -> CheckoutOut:
    """Place an order from the cart. Safe to repeat: the same Idempotency-Key and request return the same order."""
    cart = service.find_cart(db, request.cookies.get(CART_COOKIE))
    order = service.place_order(db, _settings(request), cart, body, idempotency_key)
    return presenters.checkout_out(
        order, service.payment_url(db, _settings(request), order, _client_ip(request))
    )


@router.post("/orders/lookup", response_model=OrderOut)
def lookup(body: LookupIn, request: Request, db: Db) -> OrderOut:
    ip = _client_ip(request)
    if _lookup_limiter.blocked(ip):
        raise AppError(429, "too_many_attempts", "Too many attempts. Please wait a minute and try again.")
    _lookup_limiter.hit(ip)
    return presenters.public_order(service.lookup_order(db, body.code, body.phone))


# ------------------------------------------------------------------ online payment (VNPay sandbox)
@router.get("/payments/vnpay/ipn", include_in_schema=True)
def vnpay_ipn(request: Request, db: Db) -> JSONResponse:
    """The gateway calls this from its servers after a payment. It is the source of truth, not the browser return."""
    code, message = service.apply_vnpay_ipn(db, _settings(request), dict(request.query_params))
    return JSONResponse({"RspCode": code, "Message": message})


@router.get("/payments/vnpay/return", response_model=PaymentReturnOut)
def vnpay_return(request: Request, db: Db) -> PaymentReturnOut:
    """The customer's browser lands on the web page, which asks this what to show. It never changes anything."""
    result, code = service.vnpay_return_result(db, _settings(request), dict(request.query_params))
    return PaymentReturnOut(result=result, order_code=code)  # type: ignore[arg-type]
