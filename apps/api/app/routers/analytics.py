"""Analytics API (read-only). Every route requires an admin login."""
from __future__ import annotations

from dataclasses import replace
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .. import analytics as A
from .. import analytics_ai as AI
from .. import config, schemas as S
from ..db import get_db
from ..deps import admin, get_f
from ..metrics import METRIC_DEFS, METRIC_KEYS, STATUS_LABEL, safe_ratio, Ratio
from ..models import Content, Product, WebEvent

router = APIRouter(prefix="/api", tags=["analytics"], dependencies=[Depends(admin)])

# Metrics used to rank contents
RANKS = {
    "orders": ("Số đơn được quy", lambda r: r.orders, "int"),
    "revenue": ("Doanh thu được quy", lambda r: r.revenue, "vnd"),
    "orders_per_1000": ("Đơn / 1.000 lượt xem", lambda r: r.r_orders_per_1000(), "dec"),
    "click_per_view": ("Click / lượt xem (%)", lambda r: r.r_click_per_view(), "pct"),
    "order_per_click": ("Đơn / click (%)", lambda r: r.r_order_per_click(), "pct"),
    "roas": ("ROAS", lambda r: r.r_roas(), "x"),
}


def _value(x):
    return getattr(x, "value", None)


def _source(s: dict) -> dict:
    return {"key": s["key"], "name": s["name"], "platform": s["platform"], "api": s["api"], "note": s["note"],
            "lastDate": S.iso(s.get("last_date")), "nContents": s.get("n_contents", 0), "daysOld": s.get("days_old")}


# ------------------------------------------------------------------- meta
@router.get("/meta")
def meta(db: Session = Depends(get_db)):
    n_demo = db.scalar(select(func.count()).select_from(Content).where(Content.is_demo.is_(True))) or 0
    n_real = db.scalar(select(func.count()).select_from(Content).where(Content.is_demo.is_(False))) or 0
    return {
        "enums": {
            "platforms": config.PLATFORMS, "kinds": config.CONTENT_KINDS, "distributions": config.DISTRIBUTIONS,
            "destinations": config.DESTINATIONS, "aiGroups": config.AI_GROUPS, "levels": config.ATTRIBUTION_LEVELS,
            "orderStatuses": config.ORDER_STATUSES, "costTypes": config.COST_TYPES, "methods": config.ATTRIBUTION_METHODS,
            "modes": A.MODES, "metricKeys": METRIC_KEYS, "statusLabels": STATUS_LABEL,
        },
        "counted": [config.ORDER_STATUSES[s] for s in config.COUNTED_STATUSES],
        "targets": config.KPI_TARGETS,
        "metricDefs": METRIC_DEFS,
        "options": {
            "campaigns": [c for (c,) in db.execute(select(Content.campaign).where(Content.campaign != "").distinct().order_by(Content.campaign))],
            "skus": [{"sku": s, "name": n} for s, n in db.execute(select(Product.sku, Product.name).order_by(Product.sku))],
            "contents": [{"code": c, "title": t} for c, t in db.execute(select(Content.code, Content.title).where(Content.kind != "shop").order_by(Content.code))],
        },
        "counts": {"demo": n_demo, "real": n_real},
    }


# --------------------------------------------------------------- overview
@router.get("/overview")
def overview(rank: str = "orders_per_1000", db: Session = Depends(get_db), f: A.Filters = Depends(get_f)):
    rows = A.build_rows(db, f)
    s = A.summarize(rows)
    totals = A.order_totals(db, f, rows)
    kind_views = lambda k: A.summarize([r for r in rows if r.c.kind == k and not r.is_ad])["views"]  # noqa: E731
    series = A.daily_series(db, f, rows)
    cov = A.coverage_matrix(rows)
    if rank not in RANKS:
        rank = "orders_per_1000"
    ranked = [(r, RANKS[rank][1](r)) for r in rows]
    ranked = [(r, v) for r, v in ranked if _value(v) is not None]
    ranked.sort(key=lambda x: _value(x[1]), reverse=True)
    pack = lambda lst: [{"row": S.row(r), "value": S.agg(v) if hasattr(v, "status") else S.ratio(v)} for r, v in lst]  # noqa: E731
    plat = []
    for p, label in config.PLATFORMS.items():
        rs = [r for r in rows if r.c.platform == p]
        plat.append({"key": p, "label": label, "n": len(rs), "summary": S.summary(A.summarize(rs)) if rs else None})
    start = datetime.combine(f.date_from, datetime.min.time())
    end = datetime.combine(f.date_to + timedelta(days=1), datetime.min.time())
    wq = select(WebEvent.event_type, func.count(func.distinct(WebEvent.session_id))).where(WebEvent.ts >= start, WebEvent.ts < end)
    if f.mode == "demo":
        wq = wq.where(WebEvent.is_demo.is_(True))
    elif f.mode == "real":
        wq = wq.where(WebEvent.is_demo.is_(False))
    web = dict(db.execute(wq.group_by(WebEvent.event_type)).all())
    return {
        "filters": S.filters(f), "nContents": len(rows), "summary": S.summary(s),
        "reach": {"video": S.agg(kind_views("video")), "live": S.agg(kind_views("live")), "post": S.agg(kind_views("post")),
                  "impressions": S.agg(s["impressions"])},
        "totals": {"counted": totals.counted, "revenue": totals.revenue, "notCounted": totals.not_counted,
                   "unattributed": totals.unattributed, "reportedUnreconciled": totals.reported_unreconciled},
        "web": {"pageView": web.get("page_view", 0), "productView": web.get("product_view", 0), "clickShopee": web.get("click_shopee", 0)},
        "series": series,
        "platforms": plat,
        "rank": {"key": rank, "kind": RANKS[rank][2], "label": RANKS[rank][0],
                 "options": [{"key": k, "label": v[0]} for k, v in RANKS.items()],
                 "top": pack(ranked[:5]), "bottom": pack(list(reversed(ranked[-5:]))) if len(ranked) > 5 else []},
        "sources": [_source(x) for x in A.source_status(db)],
        "warnings": A.build_warnings(db, f, rows, cov),
    }


# ------------------------------------------------------------------ Shopee
@router.get("/shopee")
def shopee(tab: str = "shop", db: Session = Depends(get_db), f: A.Filters = Depends(get_f)):
    fs = replace(f, platform="shopee")
    tab = tab if tab in ("shop", "live", "video", "ads") else "shop"
    allrows = A.build_rows(db, fs, include_shop=True)
    out: dict = {"filters": S.filters(f), "tab": tab}
    if tab == "shop":
        shop = {r.c.sku: r for r in allrows if r.c.kind == "shop"}
        stats = A.sku_order_stats(db, fs)
        lines = []
        for p in db.scalars(select(Product).order_by(Product.sku)):
            r = shop.get(p.sku)
            st = stats.get(p.sku, {"n": 0, "rev": 0.0})
            pv = r.agg("product_views").value if r else None
            lines.append({
                "product": S.product(p),
                "visits": S.agg(r.agg("views")) if r else S.agg(None),
                "productViews": S.agg(r.agg("product_views")) if r else S.agg(None),
                "addToCart": S.agg(r.agg("add_to_cart")) if r else S.agg(None),
                "atcRate": S.ratio(safe_ratio(r.agg("add_to_cart").value, pv) if r else Ratio(None, "Thiếu dữ liệu")),
                "orders": st["n"], "revenue": st["rev"],
                "orderPerProductView": S.ratio(safe_ratio(st["n"], pv) if r else Ratio(None, "Thiếu lượt xem sản phẩm")),
            })
        out["lines"] = lines
    elif tab == "live":
        out["sessions"] = [{"row": S.row(x["r"]), "session": ({
            "durationMin": x["s"].duration_min, "questionsReceived": x["s"].questions_received, "questionsAnswered": x["s"].questions_answered,
        } if x["s"] else None), "ordersPer1000": S.ratio(x["per_1000"])} for x in AI.live_sessions(db, [r for r in allrows if r.c.kind == "live"])]
    elif tab == "video":
        out["videos"] = [S.row(r) for r in allrows if r.c.kind == "video"]
    else:
        ads = [r for r in allrows if r.c.kind == "ad"]
        out["ads"] = [S.row(r) for r in ads]
        out["summary"] = S.summary(A.summarize(ads)) if ads else None
    return out


# -------------------------------------------------------------- external sources
@router.get("/external")
def external(db: Session = Depends(get_db), f: A.Filters = Depends(get_f)):
    fx = replace(f, platform=f.platform if f.platform in ("tiktok", "facebook") else "")
    rows = [r for r in A.build_rows(db, fx) if r.c.platform in ("tiktok", "facebook")]
    direct = [r for r in rows if r.c.destination == "shopee"]
    via_web = [r for r in rows if r.c.destination == "website"]
    return {
        "filters": S.filters(f),
        "direct": {"rows": [S.row(r) for r in direct], "summary": S.summary(A.summarize(direct)) if direct else None},
        "viaWeb": {"rows": [S.row(r) for r in via_web], "summary": S.summary(A.summarize(via_web)) if via_web else None,
                   "funnel": [S.step(st) for st in A.funnel(via_web, "website")] if via_web else []},
    }


# -------------------------------------------------------------------- funnel
@router.get("/funnel")
def funnel(path: str = "", cmp: str = "", cmp_content: str = "", db: Session = Depends(get_db), f: A.Filters = Depends(get_f)):
    rows = A.build_rows(db, f)
    if path not in ("direct", "website"):
        path = "website" if rows and all(r.c.destination == "website" for r in rows) else "direct"
    dest = "website" if path == "website" else "shopee"
    rows_p = [r for r in rows if r.c.destination == dest]
    steps = A.funnel(rows_p, path)
    other = other_sum = other_label = None
    if cmp == "prev":
        of = f.previous()
        orows = [r for r in A.build_rows(db, of) if r.c.destination == dest]
        other, other_label = A.funnel(orows, path), f"Kỳ trước ({of.date_from:%d/%m} – {of.date_to:%d/%m})"
        other_sum = A.summarize(orows) if orows else None
    elif cmp == "content" and cmp_content:
        of = A.Filters(f.date_from, f.date_to, content=cmp_content, mode=f.mode)
        orows = A.build_rows(db, of)
        other, other_label = A.funnel(orows, path), f"Nội dung {cmp_content}"
        other_sum = A.summarize(orows) if orows else None
    return {
        "filters": S.filters(f), "path": path, "nAll": len(rows),
        "mixed": bool(rows_p) and any(r.is_ad for r in rows_p) and any(not r.is_ad for r in rows_p),
        "steps": [S.step(s) for s in steps], "summary": S.summary(A.summarize(rows_p)) if rows_p else None,
        "rows": [S.row(r) for r in rows_p],
        "compare": {"kind": cmp, "content": cmp_content, "label": other_label, "steps": [S.step(s) for s in other] if other else None,
                    "summary": S.summary(other_sum)},
    }


# ---------------------------------------------------------------------- AI
@router.get("/ai")
def ai(db: Session = Depends(get_db), f: A.Filters = Depends(get_f)):
    rows = A.build_rows(db, f)
    chat = AI.chat_stats(db, f)
    return {
        "filters": S.filters(f),
        "chat": {
            "n": chat["n"], "sessions": chat["sessions"], "resolved": S.ratio(chat["resolved"]), "handoff": S.ratio(chat["handoff"]),
            "accuracy": S.ratio(chat["accuracy"]), "reviewed": chat["reviewed"], "avgLatency": chat["avg_latency"],
            "p95Latency": chat["p95_latency"], "buy": S.ratio(chat["buy"]), "cost": chat["cost"], "costPerQuestion": chat["cost_per_q"],
            "byIntent": [{"intent": x["intent"], "label": x["label"], "n": x["n"], "handoff": x["handoff"], "reviewed": x["reviewed"],
                          "correct": x["correct"], "buy": x["buy"], "handoffRate": S.ratio(x["handoff_rate"]),
                          "accuracy": S.ratio(x["accuracy"])} for x in chat["by_intent"]],
        },
        "lives": [{"row": S.row(x["r"]), "answerRate": S.ratio(x["answer_rate"]), "ordersPer1000": S.ratio(x["per_1000"]),
                   "session": ({"durationMin": x["s"].duration_min, "questionsReceived": x["s"].questions_received,
                                "questionsAnswered": x["s"].questions_answered, "accuracyPct": x["s"].accuracy_pct,
                                "avgDispatchMs": x["s"].avg_dispatch_ms, "avgE2eMs": x["s"].avg_e2e_ms, "interventions": x["s"].interventions,
                                "interruptions": x["s"].interruptions, "costVnd": x["s"].cost_vnd} if x["s"] else None)}
                  for x in AI.live_sessions(db, rows)],
        "videos": [{"row": S.row(x["r"]), "minutes": x["p"].minutes if x["p"] else None,
                    "scriptVersion": x["p"].script_version if x["p"] else "", "productionCost": x["prod_cost"]} for x in AI.video_ai(db, rows)],
        "compare": [{"group": g["group"], "label": g["label"], "n": g["n"], "summary": S.summary(g["s"]), "avgMinutes": g["avg_minutes"],
                     "enough": g["enough"]} for g in AI.group_compare(rows, db)],
    }


# ---------------------------------------------------------------- products
@router.get("/products")
def products(db: Session = Depends(get_db)):
    odoo = [s for s in config.SOURCES if s["key"] == "odoo"][0]
    return {"products": [S.product(p) for p in db.scalars(select(Product).order_by(Product.sku))],
            "odoo": {"api": odoo["api"], "note": odoo["note"]}}
