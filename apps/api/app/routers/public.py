"""Public area: storefront products, website event tracking, redirect to Shopee."""
from __future__ import annotations

import re
import secrets
import time

from fastapi import APIRouter, Depends, Request, Response
from fastapi.responses import JSONResponse, RedirectResponse
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import schemas as S
from ..db import get_db
from ..models import Content, Product, WebEvent

router = APIRouter(prefix="/api/public", tags=["public"])
_hits: dict[str, list[float]] = {}
_SAFE = re.compile(r"[^A-Za-z0-9_\-\.\|]")


def _limited(key: str, limit: int, window: int) -> bool:
    now = time.time()
    hits = [t for t in _hits.get(key, []) if now - t < window]
    if len(hits) >= limit:
        _hits[key] = hits
        return True
    hits.append(now)
    _hits[key] = hits
    return False


def _clean(v: str | None, n: int = 60) -> str:
    return _SAFE.sub("", (v or ""))[:n]


def _sid(request: Request) -> tuple[str, bool]:
    sid = _clean(request.cookies.get("ss_sid"))
    return (sid, False) if sid else (secrets.token_hex(8), True)


def _content_code(db: Session, code: str) -> str:
    code = _clean(code, 40)
    return code if code and db.get(Content, code) else ""


@router.get("/products")
def products(db: Session = Depends(get_db)):
    return {"products": [S.product(p) for p in db.scalars(select(Product).order_by(Product.sku).limit(3))]}


class Event(BaseModel):
    type: str
    sku: str = ""
    content: str = ""
    src: str = ""
    camp: str = ""


@router.post("/event")
def event(body: Event, request: Request, response: Response, db: Session = Depends(get_db)):
    sid, new = _sid(request)
    if body.type not in ("page_view", "product_view"):
        return JSONResponse({"ok": False}, status_code=400)
    if _limited(f"ev:{sid}", 120, 3600):
        return JSONResponse({"ok": False}, status_code=429)
    sku = _clean(body.sku, 40)
    if sku and not db.get(Product, sku):
        sku = ""
    db.add(WebEvent(event_type=body.type, sku=sku, content_code=_content_code(db, body.content), utm_source=_clean(body.src),
                    utm_campaign=_clean(body.camp, 100), session_id=sid, is_demo=False))
    db.commit()
    if new:
        response.set_cookie("ss_sid", sid, max_age=60 * 60 * 24 * 30, samesite="lax", httponly=True)
    return {"ok": True}


@router.get("/go/{sku}")
def go(sku: str, request: Request, db: Session = Depends(get_db)):
    p = db.get(Product, sku)
    if not p or not p.shopee_url:
        return RedirectResponse("/shop", status_code=303)
    sid, new = _sid(request)
    q = request.query_params
    db.add(WebEvent(event_type="click_shopee", sku=sku, content_code=_content_code(db, q.get("c", "")), utm_source=_clean(q.get("src")),
                    utm_campaign=_clean(q.get("camp"), 100), session_id=sid, is_demo=False))
    db.commit()
    resp = RedirectResponse(p.shopee_url, status_code=302)
    if new:
        resp.set_cookie("ss_sid", sid, max_age=60 * 60 * 24 * 30, samesite="lax", httponly=True)
    return resp
