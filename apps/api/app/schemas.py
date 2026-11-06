"""Turns the analytics objects into JSON (camelCase) for the frontend.

Convention: a missing number is always value=null plus a status; the frontend must never treat null as 0.
"""
from __future__ import annotations

from datetime import date, datetime

from .analytics import Filters, Row, Step
from .metrics import Agg, Ratio
from .models import Content, Product


def agg(a: Agg | None) -> dict:
    if a is None:
        return {"value": None, "status": "not_collected", "note": "", "basis": "", "nKnown": 0, "nTotal": 0}
    return {"value": a.value, "status": "value" if a.value is not None else a.status, "note": a.note, "basis": a.basis,
            "nKnown": a.n_known, "nTotal": a.n_total}


def ratio(r: Ratio | None) -> dict:
    if r is None:
        return {"value": None, "reason": "", "nUsed": 0, "nTotal": 0}
    return {"value": r.value, "reason": r.reason, "nUsed": r.n_used, "nTotal": r.n_total}


def iso(d: date | datetime | None) -> str | None:
    return d.isoformat() if d else None


def content(c: Content) -> dict:
    return {
        "code": c.code, "platform": c.platform, "kind": c.kind, "title": c.title, "url": c.url, "campaign": c.campaign, "sku": c.sku,
        "distribution": c.distribution, "destination": c.destination, "aiGroup": c.ai_group, "attributionLevel": c.attribution_level,
        "experiment": c.experiment, "variant": c.variant, "trackingLink": c.tracking_link, "kol": c.kol,
        "commissionRate": c.commission_rate, "publishedAt": iso(c.published_at), "isDemo": c.is_demo,
    }


def row(r: Row) -> dict:
    return {
        **content(r.c),
        "views": agg(r.agg("views")), "impressions": agg(r.agg("impressions")), "engagements": agg(r.agg("engagements")),
        "comments": agg(r.agg("comments")), "watchTimeSec": agg(r.agg("watch_time_sec")), "clicks": agg(r.clicks),
        "productViews": agg(r.agg("product_views")), "addToCart": agg(r.agg("add_to_cart")), "exposure": agg(r.exposure),
        "orders": agg(r.orders), "revenue": agg(r.revenue), "newCustomers": agg(r.new_customers), "spend": agg(r.spend),
        "totalCost": agg(r.total_cost), "acqCost": agg(r.acq_cost),
        "productionCost": r.cost.get("production"),
        "web": {"sessions": r.web["sessions"], "product": r.web["product"], "clickShopee": r.web["click_shopee"]},
        "ratios": {
            "clickPerView": ratio(r.r_click_per_view()), "orderPerClick": ratio(r.r_order_per_click()),
            "ordersPer1000": ratio(r.r_orders_per_1000()), "clicksPer1000": ratio(r.r_clicks_per_1000()),
            "roas": ratio(r.r_roas()), "costPerOrder": ratio(r.r_cost_per_order()), "cpc": ratio(r.r_cpc()),
        },
    }


_SUMMARY_AGG = {"views": "views", "impressions": "impressions", "engagements": "engagements", "clicks": "clicks", "orders": "orders",
                "revenue": "revenue", "cost": "cost", "spend": "spend"}
_SUMMARY_RATIO = {"clickPerView": "click_per_view", "orderPerClick": "order_per_click", "orderPerView": "order_per_view",
                  "clicksPer1000": "clicks_per_1000", "ordersPer1000": "orders_per_1000", "ctrAd": "ctr_ad", "cpc": "cpc",
                  "roas": "roas", "costPerOrder": "cost_per_order", "cac": "cac"}


def summary(s: dict | None) -> dict | None:
    if s is None:
        return None
    out: dict = {"n": s["n"]}
    for k, src in _SUMMARY_AGG.items():
        out[k] = agg(s[src])
    for k, src in _SUMMARY_RATIO.items():
        out[k] = ratio(s[src])
    return out


def step(st: Step) -> dict:
    return {"key": st.key, "label": st.label, "source": st.source, "agg": agg(st.agg), "rate": ratio(st.rate) if st.rate else None}


def product(p: Product) -> dict:
    return {"sku": p.sku, "name": p.name, "price": p.price, "flashPrice": p.flash_price, "stock": p.stock, "flavor": p.flavor,
            "spiceLevel": p.spice_level, "shelfLife": p.shelf_life, "shopeeUrl": p.shopee_url, "source": p.source, "isDemo": p.is_demo,
            "updatedAt": iso(p.updated_at)}


def filters(f: Filters) -> dict:
    return {"from": f.date_from.isoformat(), "to": f.date_to.isoformat(), "platform": f.platform, "dist": f.dist, "campaign": f.campaign,
            "sku": f.sku, "content": f.content, "mode": f.mode, "nDays": f.n_days}
