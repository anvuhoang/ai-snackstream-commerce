"""Queries and aggregation for the analytics screens."""
from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta
from typing import Mapping
from urllib.parse import urlencode

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from . import config
from .metrics import METRIC_KEYS, Agg, Ratio, ratio_over, safe_ratio, sum_aggs
from .models import Content, Cost, ImportBatch, MetricFact, Order, OrderAttribution, WebEvent

MODES = {"all": "Tất cả", "real": "Dữ liệu thật", "demo": "Dữ liệu demo"}


# --------------------------------------------------------------------- filters
@dataclass
class Filters:
    date_from: date
    date_to: date
    platform: str = ""
    dist: str = ""
    campaign: str = ""
    sku: str = ""
    content: str = ""
    mode: str = "all"

    @classmethod
    def from_params(cls, p: Mapping[str, str]) -> "Filters":
        def d(key: str, default: date) -> date:
            try:
                return date.fromisoformat(p.get(key, ""))
            except ValueError:
                return default

        today = date.today()
        f = cls(
            date_from=d("from", today - timedelta(days=29)),
            date_to=d("to", today),
            platform=p.get("platform", "") if p.get("platform", "") in config.PLATFORMS else "",
            dist=p.get("dist", "") if p.get("dist", "") in config.DISTRIBUTIONS else "",
            campaign=p.get("campaign", ""),
            sku=p.get("sku", ""),
            content=p.get("content", ""),
            mode=p.get("mode", "all") if p.get("mode", "all") in MODES else "all",
        )
        if f.date_from > f.date_to:
            f.date_from, f.date_to = f.date_to, f.date_from
        return f

    def params(self, **over) -> dict:
        today = date.today()
        base = {
            "from": self.date_from.isoformat(), "to": self.date_to.isoformat(),
            "platform": self.platform, "dist": self.dist, "campaign": self.campaign,
            "sku": self.sku, "content": self.content, "mode": self.mode,
        }
        base.update({k: v for k, v in over.items()})
        out = {k: v for k, v in base.items() if v not in ("", None)}
        if out.get("mode") == "all":
            out.pop("mode")
        if out.get("to") == today.isoformat():
            out.pop("to")
        if out.get("from") == (today - timedelta(days=29)).isoformat():
            out.pop("from")
        return out

    def qs(self, **over) -> str:
        p = self.params(**over)
        return "?" + urlencode(p) if p else ""

    @property
    def n_days(self) -> int:
        return (self.date_to - self.date_from).days + 1

    def previous(self) -> "Filters":
        n = self.n_days
        return Filters(self.date_from - timedelta(days=n), self.date_from - timedelta(days=1), self.platform,
                       self.dist, self.campaign, self.sku, self.content, self.mode)

    def has_content_filter(self) -> bool:
        return bool(self.platform or self.dist or self.campaign or self.content)


def _mode_filter(col, mode: str):
    if mode == "demo":
        return col.is_(True)
    if mode == "real":
        return col.is_(False)
    return None


# ------------------------------------------------------------- content rows
@dataclass
class Row:
    c: Content
    m: dict[str, Agg]
    orders: Agg
    revenue: Agg
    new_customers: Agg
    cost: dict[str, float]
    web: dict[str, int]
    n_orders_all: int = 0

    def agg(self, key: str) -> Agg:
        return self.m.get(key) or Agg.missing("not_collected")

    @property
    def is_ad(self) -> bool:
        return self.c.kind == "ad"

    @property
    def exposure(self) -> Agg:
        return self.agg("impressions") if self.is_ad else self.agg("views")

    @property
    def clicks(self) -> Agg:
        return self.agg("clicks")

    @property
    def spend(self) -> Agg:
        if "spend" in self.cost:
            return Agg(self.cost["spend"])
        return Agg.missing("not_collected" if self.c.distribution == "paid" else "not_provided",
                           "" if self.c.distribution == "paid" else "Không phải nội dung trả phí")

    @property
    def total_cost(self) -> Agg:
        return Agg(sum(self.cost.values())) if self.cost else Agg.missing("not_collected")

    @property
    def acq_cost(self) -> Agg:
        v = {k: x for k, x in self.cost.items() if k in ("spend", "commission")}
        return Agg(sum(v.values())) if v else Agg.missing("not_collected")

    @property
    def level_label(self) -> str:
        return config.ATTRIBUTION_LEVELS.get(self.c.attribution_level, self.c.attribution_level)

    # per-content ratios
    def r_click_per_view(self) -> Ratio:
        return safe_ratio(self.clicks.value, self.exposure.value)

    def r_order_per_click(self) -> Ratio:
        return safe_ratio(self.orders.value, self.clicks.value)

    def r_orders_per_1000(self) -> Ratio:
        return safe_ratio(self.orders.value, self.exposure.value, 1000)

    def r_clicks_per_1000(self) -> Ratio:
        return safe_ratio(self.clicks.value, self.exposure.value, 1000)

    def r_cpc(self) -> Ratio:
        return safe_ratio(self.spend.value, self.clicks.value, 1)

    def r_roas(self) -> Ratio:
        return safe_ratio(self.revenue.value, self.spend.value, 1)

    def r_cost_per_order(self) -> Ratio:
        return safe_ratio(self.total_cost.value, self.orders.value, 1)


def select_contents(db: Session, f: Filters) -> list[Content]:
    q = select(Content)
    if (cond := _mode_filter(Content.is_demo, f.mode)) is not None:
        q = q.where(cond)
    if f.platform:
        q = q.where(Content.platform == f.platform)
    if f.dist:
        q = q.where(Content.distribution == f.dist)
    if f.campaign:
        q = q.where(Content.campaign == f.campaign)
    if f.sku:
        q = q.where(Content.sku == f.sku)
    if f.content:
        q = q.where(Content.code == f.content)
    return list(db.scalars(q.order_by(Content.platform, Content.kind, Content.code)))


def build_rows(db: Session, f: Filters, contents: list[Content] | None = None, include_shop: bool = False) -> list[Row]:
    contents = select_contents(db, f) if contents is None else contents
    if not include_shop:
        contents = [c for c in contents if c.kind != "shop"]
    codes = [c.code for c in contents]
    if not codes:
        return []

    # --- daily metrics
    agg: dict[tuple[str, str], dict] = {}
    for code, key, avail, val in db.execute(
        select(MetricFact.content_code, MetricFact.metric_key, MetricFact.availability, MetricFact.value).where(
            MetricFact.content_code.in_(codes), MetricFact.date >= f.date_from, MetricFact.date <= f.date_to)
    ):
        a = agg.setdefault((code, key), {"sum": 0.0, "n": 0, "st": defaultdict(int)})
        if avail == "value" and val is not None:
            a["sum"] += val
            a["n"] += 1
        else:
            a["st"][avail] += 1

    # --- orders attributed to content
    ostat: dict[str, dict] = {}
    for o, code in db.execute(
        select(Order, OrderAttribution.content_code).join(OrderAttribution, OrderAttribution.order_id == Order.order_id).where(
            OrderAttribution.content_code.in_(codes), Order.order_date >= f.date_from, Order.order_date <= f.date_to)
    ):
        s = ostat.setdefault(code, {"n": 0, "rev": 0.0, "all": 0, "new_known": 0, "new_true": 0})
        s["all"] += 1
        if o.status in config.COUNTED_STATUSES:
            s["n"] += 1
            s["rev"] += o.revenue
            if o.is_new_customer is not None:
                s["new_known"] += 1
                s["new_true"] += 1 if o.is_new_customer else 0

    # --- costs
    costs: dict[str, dict[str, float]] = defaultdict(lambda: defaultdict(float))
    for code, ctype, amount in db.execute(
        select(Cost.content_code, Cost.cost_type, Cost.amount).where(
            Cost.content_code.in_(codes), Cost.date >= f.date_from, Cost.date <= f.date_to)
    ):
        costs[code][ctype] += amount

    # --- website events (counted per session)
    web: dict[str, dict[str, set]] = defaultdict(lambda: defaultdict(set))
    start = datetime.combine(f.date_from, datetime.min.time())
    end = datetime.combine(f.date_to + timedelta(days=1), datetime.min.time())
    for code, etype, sess in db.execute(
        select(WebEvent.content_code, WebEvent.event_type, WebEvent.session_id).where(
            WebEvent.content_code.in_(codes), WebEvent.ts >= start, WebEvent.ts < end)
    ):
        web[code][etype].add(sess)

    rows: list[Row] = []
    for c in contents:
        m: dict[str, Agg] = {}
        for key in METRIC_KEYS:
            a = agg.get((c.code, key))
            if a is None:
                m[key] = Agg.missing("not_collected")
            elif a["n"] > 0:
                m[key] = Agg(a["sum"])
            else:
                m[key] = Agg.missing(max(a["st"], key=a["st"].get))

        s = ostat.get(c.code)
        rep_o, rep_r = m["orders_reported"], m["revenue_reported"]
        if s and s["n"] + s["all"] > 0:
            orders = Agg(float(s["n"]), basis="order_level")
            revenue = Agg(s["rev"], basis="order_level")
            if s["n"] == 0:
                new = Agg(0.0)
            elif s["new_known"] == s["n"]:
                new = Agg(float(s["new_true"]))
            else:
                new = Agg.missing("not_provided", "Nguồn không cho biết khách mới")
        elif rep_o.known:
            orders = Agg(rep_o.value, basis="reported")
            revenue = Agg(rep_r.value, basis="reported") if rep_r.known else Agg.missing(rep_r.status)
            new = Agg.missing("not_provided", "Nguồn không cho biết khách mới")
        elif c.attribution_level == "order":
            has_data = any(agg.get((c.code, k)) and agg[(c.code, k)]["n"] > 0 for k in METRIC_KEYS)
            if has_data:
                orders, revenue = Agg(0.0, basis="order_level"), Agg(0.0, basis="order_level")
                new = Agg.missing("not_provided", "Không có đơn")
            else:
                orders, revenue, new = Agg.missing("not_collected"), Agg.missing("not_collected"), Agg.missing("not_collected")
        else:
            why = {"awareness": "Mới biết đến lượt xem, chưa theo dõi được đơn",
                   "click": "Chỉ biết click, không nối được tới đơn",
                   "visit": "Biết lượt đến website, không nối được tới đơn"}.get(c.attribution_level, "")
            orders = Agg.missing("undetermined", why)
            revenue = Agg.missing("undetermined", why)
            new = Agg.missing("undetermined", why)

        w = web.get(c.code, {})
        wc = {"sessions": len(w.get("page_view", ())), "product": len(w.get("product_view", ())),
              "click_shopee": len(w.get("click_shopee", ()))}
        rows.append(Row(c, m, orders, revenue, new, dict(costs.get(c.code, {})), wc, s["all"] if s else 0))
    return rows


# -------------------------------------------------------------- source orders
@dataclass
class OrderTotals:
    counted: int
    revenue: float
    not_counted: int
    unattributed: int
    reported_unreconciled: float  # orders from aggregate reports; never added to the total


def order_totals(db: Session, f: Filters, rows: list[Row]) -> OrderTotals:
    """Total orders come from the orders table (keyed by order id => never double-counted)."""
    q = select(Order, OrderAttribution.content_code).outerjoin(OrderAttribution, OrderAttribution.order_id == Order.order_id).where(
        Order.order_date >= f.date_from, Order.order_date <= f.date_to)
    if (cond := _mode_filter(Order.is_demo, f.mode)) is not None:
        q = q.where(cond)
    if f.sku:
        q = q.where(Order.sku == f.sku)
    allowed = {r.c.code for r in rows}
    counted = rev = nc = un = 0
    for o, code in db.execute(q):
        if f.has_content_filter() and code not in allowed:
            continue
        if code is None:
            un += 1 if o.status in config.COUNTED_STATUSES else 0
        if o.status in config.COUNTED_STATUSES:
            counted += 1
            rev += o.revenue
        else:
            nc += 1
    reported = sum(r.orders.value or 0 for r in rows if r.orders.basis == "reported")
    return OrderTotals(counted, rev, nc, un, reported)


# ------------------------------------------------------------------ grouping
def total(rows: list[Row], fn) -> Agg:
    return sum_aggs(fn(r) for r in rows)


def rows_where(rows: list[Row], **kw) -> list[Row]:
    out = rows
    for k, v in kw.items():
        out = [r for r in out if getattr(r.c, k) == v]
    return out


def group_rows(rows: list[Row], key) -> dict:
    out: dict = {}
    for r in rows:
        out.setdefault(key(r), []).append(r)
    return out


def summarize(rows: list[Row]) -> dict:
    """Aggregate metrics for a group of contents. Ratios use only data measured on the same scope."""
    non_ad = [r for r in rows if not r.is_ad]
    ads = [r for r in rows if r.is_ad]
    return {
        "n": len(rows),
        "views": total(non_ad, lambda r: r.agg("views")),
        "impressions": total(ads, lambda r: r.agg("impressions")),
        "engagements": total(rows, lambda r: r.agg("engagements")),
        "clicks": total(rows, lambda r: r.clicks),
        "orders": total(rows, lambda r: r.orders),
        "revenue": total(rows, lambda r: r.revenue),
        "cost": total(rows, lambda r: r.total_cost),
        "spend": total(ads, lambda r: r.spend),
        "click_per_view": ratio_over(non_ad, lambda r: r.clicks, lambda r: r.agg("views")),
        "order_per_click": ratio_over(rows, lambda r: r.orders, lambda r: r.clicks),
        "order_per_view": ratio_over(non_ad, lambda r: r.orders, lambda r: r.agg("views")),
        "clicks_per_1000": ratio_over(non_ad, lambda r: r.clicks, lambda r: r.agg("views"), 1000),
        "orders_per_1000": ratio_over(non_ad, lambda r: r.orders, lambda r: r.agg("views"), 1000),
        "ctr_ad": ratio_over(ads, lambda r: r.clicks, lambda r: r.agg("impressions")),
        "cpc": ratio_over(ads, lambda r: r.spend, lambda r: r.clicks, 1),
        "roas": ratio_over([r for r in rows if r.c.distribution == "paid"], lambda r: r.revenue, lambda r: r.spend, 1),
        "cost_per_order": ratio_over(rows, lambda r: r.total_cost, lambda r: r.orders, 1),
        "cac": ratio_over(rows, lambda r: r.acq_cost, lambda r: r.new_customers, 1),
    }


# ------------------------------------------------------------------- funnel
@dataclass
class Step:
    key: str
    label: str
    source: str
    agg: Agg
    fn: object = field(repr=False, default=None)
    rate: Ratio | None = None  # rate from the previous step -> this step


def _web_agg(key: str):
    def fn(r: Row) -> Agg:
        if r.c.destination == "shopee" and not r.web["sessions"]:
            return Agg.missing("not_provided", "Đi thẳng Shopee, không qua website")
        return Agg(float(r.web[key]))
    return fn


DIRECT_STEPS = [
    ("exposure", "Xem / hiển thị nội dung", "Báo cáo nền tảng", lambda r: r.exposure),
    ("clicks", "Click vào sản phẩm / link", "Báo cáo nền tảng", lambda r: r.clicks),
    ("product_views", "Xem sản phẩm", "Báo cáo Shopee", lambda r: r.agg("product_views")),
    ("add_to_cart", "Thêm giỏ hàng", "Báo cáo Shopee", lambda r: r.agg("add_to_cart")),
    ("orders", "Mua (đơn được ghi nhận)", "Đơn hàng đối chiếu", lambda r: r.orders),
]
WEBSITE_STEPS = [
    ("exposure", "Xem / hiển thị nội dung", "Báo cáo nền tảng", lambda r: r.exposure),
    ("clicks", "Click ra website", "Báo cáo nền tảng", lambda r: r.clicks),
    ("sessions", "Vào website (có nguồn)", "Sự kiện website", _web_agg("sessions")),
    ("product", "Xem sản phẩm trên website", "Sự kiện website", _web_agg("product")),
    ("click_shopee", "Click sang Shopee", "Sự kiện website", _web_agg("click_shopee")),
    ("orders", "Mua (đơn được ghi nhận)", "Đơn hàng đối chiếu", lambda r: r.orders),
]


def funnel(rows: list[Row], path: str = "direct") -> list[Step]:
    spec = WEBSITE_STEPS if path == "website" else DIRECT_STEPS
    steps = [Step(k, label, src, sum_aggs(fn(r) for r in rows), fn) for k, label, src, fn in spec]
    for prev, cur in zip(steps, steps[1:]):
        cur.rate = ratio_over(rows, cur.fn, prev.fn)
    return steps


# ---------------------------------------------------------- daily series
def daily_series(db: Session, f: Filters, rows: list[Row]) -> dict:
    days = [f.date_from + timedelta(days=i) for i in range(f.n_days)]
    idx = {d: i for i, d in enumerate(days)}
    plat = {r.c.code: r.c.platform for r in rows}
    kind = {r.c.code: r.c.kind for r in rows}
    codes = list(plat)
    views = {p: [None] * len(days) for p in config.PLATFORMS}  # None = no data for that day (not 0)
    clicks = {p: [None] * len(days) for p in config.PLATFORMS}
    cost = [0.0] * len(days)
    orders = [0] * len(days)
    revenue = [0.0] * len(days)
    if codes:
        for code, d, key, val in db.execute(
            select(MetricFact.content_code, MetricFact.date, MetricFact.metric_key, MetricFact.value).where(
                MetricFact.content_code.in_(codes), MetricFact.date >= f.date_from, MetricFact.date <= f.date_to,
                MetricFact.availability == "value", MetricFact.metric_key.in_(("views", "clicks")))
        ):
            if val is None or d not in idx:
                continue
            if key == "views" and kind[code] != "ad":
                views[plat[code]][idx[d]] = (views[plat[code]][idx[d]] or 0) + val
            elif key == "clicks":
                clicks[plat[code]][idx[d]] = (clicks[plat[code]][idx[d]] or 0) + val
        for d, amount in db.execute(select(Cost.date, Cost.amount).where(
                Cost.content_code.in_(codes), Cost.date >= f.date_from, Cost.date <= f.date_to)):
            cost[idx[d]] += amount
    q = select(Order, OrderAttribution.content_code).outerjoin(OrderAttribution, OrderAttribution.order_id == Order.order_id).where(
        Order.order_date >= f.date_from, Order.order_date <= f.date_to, Order.status.in_(config.COUNTED_STATUSES))
    if (cond := _mode_filter(Order.is_demo, f.mode)) is not None:
        q = q.where(cond)
    if f.sku:
        q = q.where(Order.sku == f.sku)
    allowed = set(codes)
    for o, code in db.execute(q):
        if f.has_content_filter() and code not in allowed:
            continue
        orders[idx[o.order_date]] += 1
        revenue[idx[o.order_date]] += o.revenue
    return {"days": [d.isoformat() for d in days], "views": views, "clicks": clicks,
            "cost": cost, "orders": orders, "revenue": revenue}


# -------------------------------------------------- data coverage & warnings
def coverage_matrix(rows: list[Row]) -> list[dict]:
    groups = group_rows(rows, lambda r: (r.c.platform, r.c.kind))
    keys = ("views", "impressions", "engagements", "clicks", "product_views", "add_to_cart", "watch_time_sec")
    out = []
    for (plat, kind), rs in sorted(groups.items()):
        cells = {}
        for k in keys:
            if kind == "ad" and k in ("views", "watch_time_sec"):
                cells[k] = None
                continue
            if kind != "ad" and k == "impressions":
                cells[k] = None
                continue
            known = sum(1 for r in rs if r.agg(k).known)
            st = [r.agg(k).status for r in rs if not r.agg(k).known]
            cells[k] = {"known": known, "total": len(rs),
                        "status": max(set(st), key=st.count) if st else "value"}
        orders_known = sum(1 for r in rs if r.orders.known)
        cells["orders"] = {"known": orders_known, "total": len(rs),
                           "status": "value" if orders_known == len(rs) else "undetermined"}
        out.append({"platform": plat, "kind": kind, "n": len(rs), "cells": cells})
    return out


def source_status(db: Session) -> list[dict]:
    last_by_platform = {p: (d, n) for p, d, n in db.execute(
        select(Content.platform, func.max(MetricFact.date), func.count(func.distinct(Content.code)))
        .join(MetricFact, MetricFact.content_code == Content.code).group_by(Content.platform))}
    last_batch = db.scalar(select(func.max(ImportBatch.created_at)).where(ImportBatch.method != "seed"))
    out = []
    for s in config.SOURCES:
        info = last_by_platform.get(s["platform"]) if s["platform"] else None
        days_old = (date.today() - info[0]).days if info and info[0] else None
        out.append({**s, "last_date": info[0] if info else None, "n_contents": info[1] if info else 0, "days_old": days_old})
    return [{**o, "last_batch": last_batch} for o in out]


def build_warnings(db: Session, f: Filters, rows: list[Row], cov: list[dict]) -> list[dict]:
    w: list[dict] = []
    n_demo = sum(1 for r in rows if r.c.is_demo)
    if n_demo:
        w.append({"level": "info", "text": f"{n_demo}/{len(rows)} nội dung đang hiển thị là dữ liệu DEMO, không phải số liệu thật."})
    if not rows:
        w.append({"level": "warn", "text": "Chưa có nội dung nào trong phạm vi lọc. Nhập dữ liệu ở mục Quản lý dữ liệu."})
        return w
    for g in cov:
        for k, cell in g["cells"].items():
            if cell and cell["total"] and cell["known"] == 0 and k in ("clicks", "orders"):
                label = f"{config.PLATFORMS.get(g['platform'], g['platform'])} · {config.CONTENT_KINDS.get(g['kind'], g['kind'])}"
                w.append({"level": "warn", "text": f"{label}: chưa có dữ liệu \"{METRIC_KEYS.get(k, 'Đơn hàng')}\" nào."})
    for s in source_status(db):
        if s["platform"] and s["days_old"] is not None and s["days_old"] > 3:
            w.append({"level": "warn", "text": f"{s['name']}: dữ liệu cũ {s['days_old']} ngày (gần nhất {s['last_date']})."})
    w.append({"level": "info", "text": "Lượt xem của các nền tảng không thể cộng thành số người duy nhất; mỗi nền tảng được hiển thị riêng."})
    return w


def sku_order_stats(db: Session, f: Filters) -> dict[str, dict]:
    """Orders per SKU read straight from the orders table (no attribution step) => never double-counted."""
    q = select(Order).where(Order.order_date >= f.date_from, Order.order_date <= f.date_to,
                            Order.status.in_(config.COUNTED_STATUSES))
    if (cond := _mode_filter(Order.is_demo, f.mode)) is not None:
        q = q.where(cond)
    out: dict[str, dict] = {}
    for o in db.scalars(q):
        s = out.setdefault(o.sku, {"n": 0, "rev": 0.0})
        s["n"] += 1
        s["rev"] += o.revenue
    return out
