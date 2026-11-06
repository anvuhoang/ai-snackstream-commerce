"""Labelled DEMO data (is_demo=True). Covers every scenario: going straight to Shopee, going through the website,
ads reported only as aggregates, sources that do not provide a metric, and orders with an unknown source."""
from __future__ import annotations

import math
import random
from datetime import date, datetime, timedelta
from urllib.parse import quote

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from .models import (AiLiveSession, ChatLog, Content, Cost, ImportBatch, MetricFact, Order, OrderAttribution, Product,
                     VideoProduction, WebEvent)

PRODUCTS = [
    ("BTT-001", "Bánh tráng trộn Tây Ninh 250g", 39000, 29000, 240, "Muối tôm, hành phi, sa tế", "Cay vừa", "6 tháng"),
    ("BK-001", "Bò khô sợi cay 200g", 129000, 99000, 85, "Cay đậm, tẩm gia vị", "Cay nhiều", "5 tháng"),
    ("KG-001", "Khô gà lá chanh 250g", 89000, 69000, 120, "Lá chanh, ớt", "Cay vừa", "6 tháng"),
    ("MR-001", "Mực rim me 150g", 119000, 95000, 12, "Me chua ngọt", "Cay nhẹ", "4 tháng"),
    ("BTM-001", "Bánh tráng muối tôm 200g", 29000, 22000, 400, "Muối tôm Tây Ninh", "Cay nhẹ", "6 tháng"),
    ("XS-001", "Xoài sấy dẻo 200g", 59000, 49000, 0, "Xoài chín sấy dẻo", "Không cay", "8 tháng"),
]
PRICE = {p[0]: p[2] for p in PRODUCTS}
SKUS = [p[0] for p in PRODUCTS]

HOOKS = ["Thèm ăn vặt đêm khuya", "Combo xem phim", "Quà vặt văn phòng", "Cay tê lưỡi", "Giá flash sale", "Review thật 100%",
         "Unbox gói hàng", "So sánh 3 loại", "Đặc sản Tây Ninh", "Ăn một lần nghiền"]
KOLS = ["@anvat.cungmai", "@review.bepnha", "@linh.foodie", "@kocsnack88", "@minh.anvatt"]


def _poisson(rng: random.Random, lam: float) -> int:
    if lam <= 0:
        return 0
    if lam > 30:
        return max(0, int(rng.gauss(lam, math.sqrt(lam)) + 0.5))
    l, k, p = math.exp(-lam), 0, 1.0
    while True:
        p *= rng.random()
        if p <= l:
            return k
        k += 1


def clear_demo(db: Session) -> int:
    n = 0
    demo_orders = select(Order.order_id).where(Order.is_demo.is_(True))
    for stmt in (
        delete(WebEvent).where(WebEvent.is_demo.is_(True)),
        delete(ChatLog).where(ChatLog.is_demo.is_(True)),
        delete(OrderAttribution).where(OrderAttribution.order_id.in_(demo_orders)),
        delete(OrderAttribution).where(OrderAttribution.content_code.in_(select(Content.code).where(Content.is_demo.is_(True)))),
        delete(Order).where(Order.is_demo.is_(True)),
        delete(Cost).where(Cost.is_demo.is_(True)),
        delete(MetricFact).where(MetricFact.is_demo.is_(True)),
        delete(AiLiveSession).where(AiLiveSession.is_demo.is_(True)),
        delete(VideoProduction).where(VideoProduction.is_demo.is_(True)),
        delete(Content).where(Content.is_demo.is_(True)),
        delete(Product).where(Product.is_demo.is_(True)),
        delete(ImportBatch).where(ImportBatch.is_demo.is_(True)),
    ):
        n += db.execute(stmt).rowcount or 0
    db.commit()
    return n


def seed_demo(db: Session, seed: int = 2026) -> bool:
    if db.scalar(select(Content.code).where(Content.is_demo.is_(True)).limit(1)):
        return False
    rng = random.Random(seed)
    today = date.today()
    first_day = today - timedelta(days=59)
    last_day = today - timedelta(days=1)

    batch = ImportBatch(kind="seed", filename="demo-seed", method="seed", is_demo=True,
                        source_note="Dữ liệu minh họa sinh tự động — KHÔNG phải số liệu thật")
    db.add(batch)
    db.flush()
    bid = batch.id

    for sku, name, price, flash, stock, flavor, spice, shelf in PRODUCTS:
        db.add(Product(sku=sku, name=name, price=price, flash_price=flash, stock=stock, flavor=flavor, spice_level=spice,
                       shelf_life=shelf, shopee_url=f"https://shopee.vn/search?keyword={quote(name)}", source="demo", is_demo=True))

    contents: list[dict] = []

    def add(**kw):
        kw.setdefault("destination", "shopee")
        kw.setdefault("ai_group", "human")
        kw.setdefault("distribution", "organic")
        kw.setdefault("attribution_level", "awareness")
        contents.append(kw)

    # --- storefront per SKU (product-page behaviour)
    for sku in SKUS:
        add(code=f"SHOP-{sku}", platform="shopee", kind="shop", title=f"Gian hàng · {sku}", sku=sku, attribution_level="awareness",
            pub=first_day, prof="shop")
    # --- Shopee Video (14 AI, 2 hybrid, 2 human)
    groups = ["ai"] * 14 + ["hybrid"] * 2 + ["human"] * 2
    for i in range(18):
        sku = SKUS[i % len(SKUS)]
        add(code=f"SV-{i + 1:03d}", platform="shopee", kind="video", title=f"{HOOKS[i % len(HOOKS)]} · {sku}", sku=sku,
            campaign="SnackFest-11", ai_group=groups[i], attribution_level="order", experiment="content_style",
            variant="trải nghiệm cá nhân" if i % 2 == 0 else "so sánh/unbox", pub=today - timedelta(days=rng.randint(3, 52)),
            prof="shopee_video", url=f"https://shopee.vn/video/demo-{i + 1}")
    # --- Shopee Live
    for i, g in enumerate(["ai", "ai", "ai", "human", "human", "hybrid"]):
        sku = SKUS[(i * 2) % len(SKUS)]
        add(code=f"SL-{i + 1:03d}", platform="shopee", kind="live", title=f"Phiên live #{i + 1} · {'AI avatar' if g == 'ai' else 'Host người' if g == 'human' else 'AI + host'}",
            sku=sku, campaign="SnackFest-11", ai_group=g, attribution_level="order", pub=today - timedelta(days=4 + i * 9), prof="shopee_live")
    # --- Shopee Ads
    ads = [("AD-S01", "Search · từ khóa thương hiệu", "keyword_type", "thương hiệu", "order", "orders"),
           ("AD-S02", "Search · từ khóa danh mục chung", "keyword_type", "danh mục chung", "order", "orders"),
           ("AD-D01", "Discovery · người mua cũ", "audience", "người mua cũ", "order", "orders"),
           ("AD-D02", "Discovery · lookalike", "audience", "lookalike", "order", "reported")]
    for i, (code, title, exp, var, lvl, mode) in enumerate(ads):
        add(code=code, platform="shopee", kind="ad", title=title, sku=SKUS[i % 3], campaign="Ads-Q4", distribution="paid",
            attribution_level=lvl, experiment=exp, variant=var, pub=today - timedelta(days=28 - i * 2), prof=f"shopee_ad_{mode}")
    # --- TikTok → Shopee direct (Affiliate)
    for i in range(5):
        sku = SKUS[i % len(SKUS)]
        rate = [8, 12, 15, 12, 8][i]
        add(code=f"TT-{i + 1:03d}", platform="tiktok", kind="video", title=f"{HOOKS[(i + 3) % len(HOOKS)]} · KOC", sku=sku, campaign="Affiliate-W1",
            distribution="affiliate", destination="shopee", attribution_level="order", kol=KOLS[i], commission=rate,
            experiment="commission", variant=f"{rate}%", tracking_link=f"https://s.shopee.vn/demo{i + 1}",
            pub=today - timedelta(days=rng.randint(8, 40)), prof="tiktok_aff", url=f"https://tiktok.com/@demo/video/{1000 + i}")
    # --- TikTok → website → Shopee
    for i in range(3):
        sku = SKUS[(i + 1) % len(SKUS)]
        add(code=f"TT-{i + 6:03d}", platform="tiktok", kind="video", title=f"{HOOKS[(i + 6) % len(HOOKS)]} (link bio → web)", sku=sku, campaign="Web-Funnel",
            destination="website", attribution_level="visit", pub=today - timedelta(days=rng.randint(10, 38)), prof="web_social",
            url=f"https://tiktok.com/@snackstream/video/{2000 + i}")
    # --- Facebook → website → Shopee
    for i in range(4):
        sku = SKUS[(i + 2) % len(SKUS)]
        add(code=f"FB-{i + 1:03d}", platform="facebook", kind="post", title=f"Bài FB · {HOOKS[(i + 1) % len(HOOKS)]}", sku=sku, campaign="Web-Funnel",
            destination="website", attribution_level="order" if i == 1 else "visit", pub=today - timedelta(days=rng.randint(6, 35)),
            prof="web_social_coupon" if i == 1 else "web_social", url=f"https://facebook.com/snackstream/posts/{3000 + i}")
    add(code="FB-005", platform="facebook", kind="ad", title="Quảng cáo FB → website", sku="BK-001", campaign="Web-Funnel", distribution="paid",
        destination="website", attribution_level="visit", pub=today - timedelta(days=24), prof="web_ad")
    add(code="FB-006", platform="facebook", kind="ad", title="Quảng cáo FB → Shopee trực tiếp", sku="KG-001", campaign="Ads-Q4", distribution="paid",
        destination="shopee", attribution_level="click", pub=today - timedelta(days=20), prof="fb_ad_direct")

    for c in contents:
        db.add(Content(code=c["code"], platform=c["platform"], kind=c["kind"], title=c.get("title", ""), url=c.get("url", ""),
                       campaign=c.get("campaign", ""), sku=c.get("sku", ""), distribution=c["distribution"],
                       destination=c["destination"], ai_group=c["ai_group"], attribution_level=c["attribution_level"],
                       experiment=c.get("experiment", ""), variant=c.get("variant", ""), tracking_link=c.get("tracking_link", ""),
                       kol=c.get("kol", ""), commission_rate=c.get("commission"), published_at=c["pub"], is_demo=True))
    db.flush()

    # ------------------------------------------------------------ daily metrics
    facts: list[MetricFact] = []
    costs: list[Cost] = []
    orders: list[Order] = []
    attrs: list[OrderAttribution] = []
    events: list[WebEvent] = []
    oc = [0]

    def fact(code, d, key, val=None, avail="value"):
        facts.append(MetricFact(content_code=code, date=d, metric_key=key, value=None if avail != "value" else float(round(val)),
                                availability=avail, batch_id=bid, is_demo=True))

    def make_orders(c, d, n, method, window, new_flag, commission=None, status_bias=0.0):
        rev_total = 0.0
        for _ in range(n):
            oc[0] += 1
            sku = c.get("sku") or rng.choice(SKUS)
            qty = rng.choice([1, 1, 1, 2, 2, 3])
            revenue = PRICE[sku] * qty * rng.choice([1.0, 0.8, 0.75])
            r = rng.random()
            status = "completed" if r < 0.72 else "shipping" if r < 0.86 else "cancelled" if r < 0.95 else "returned"
            oid = f"{d:%y%m%d}{oc[0]:05d}"
            nc = None if new_flag is None else (rng.random() < new_flag)
            orders.append(Order(order_id=oid, order_date=d, status=status, revenue=round(revenue, -2), sku=sku, is_new_customer=nc,
                                is_demo=True, batch_id=bid))
            if method:
                attrs.append(OrderAttribution(order_id=oid, content_code=c["code"], method=method, window_days=window))
            if commission and status in ("completed", "shipping"):
                rev_total += revenue
        if commission and rev_total:
            costs.append(Cost(content_code=c["code"], date=d, cost_type="commission", amount=round(rev_total * commission / 100, -2),
                              is_demo=True, batch_id=bid))

    sess_n = [0]

    def make_sessions(c, d, n, p_product=0.55, p_click=0.30):
        for _ in range(n):
            sess_n[0] += 1
            sid = f"demo-s{sess_n[0]}"
            ts = datetime.combine(d, datetime.min.time()) + timedelta(seconds=rng.randint(8 * 3600, 23 * 3600))
            base = dict(content_code=c["code"], utm_source=c["platform"], utm_campaign=c.get("campaign", ""), session_id=sid, is_demo=True,
                        sku=c.get("sku", ""))
            events.append(WebEvent(ts=ts, event_type="page_view", **base))
            if rng.random() < p_product:
                events.append(WebEvent(ts=ts + timedelta(seconds=20), event_type="product_view", **base))
                if rng.random() < p_click:
                    events.append(WebEvent(ts=ts + timedelta(seconds=50), event_type="click_shopee", **base))
        return

    for c in contents:
        q = max(0.35, rng.lognormvariate(0, 0.45))
        if c["ai_group"] == "hybrid":
            q *= 1.15
        start = max(c["pub"], first_day)
        days = [start + timedelta(days=i) for i in range((last_day - start).days + 1)]
        prof = c["prof"]
        code = c["code"]

        if prof == "shop":
            for d in days:
                pv = max(0, int(rng.gauss(380, 70) * (1 + 0.15 * math.sin(d.toordinal() / 3))))
                fact(code, d, "views", pv * 1.8)
                fact(code, d, "product_views", pv)
                fact(code, d, "add_to_cart", pv * rng.uniform(0.07, 0.12))
            continue

        if prof == "shopee_live":
            d = c["pub"]
            if d < first_day or d > last_day:
                d = max(first_day, min(last_day, d))
            ai = c["ai_group"] != "human"
            views = int(rng.uniform(1800, 6200) * q * (0.8 if ai else 1.1))
            clicks = int(views * rng.uniform(0.035, 0.08))
            fact(code, d, "views", views)
            fact(code, d, "engagements", views * rng.uniform(0.06, 0.12))
            fact(code, d, "comments", views * rng.uniform(0.012, 0.03))
            fact(code, d, "clicks", clicks)
            fact(code, d, "watch_time_sec", None, "not_provided")
            fact(code, d, "product_views", None, "not_provided")
            fact(code, d, "add_to_cart", None, "not_provided")
            make_orders(c, d, _poisson(rng, clicks * rng.uniform(0.07, 0.14)), "shopee_report", 1, None)
            if c["ai_group"] == "ai":
                costs.append(Cost(content_code=code, date=d, cost_type="ai_runtime", amount=round(rng.uniform(150000, 260000), -3), is_demo=True, batch_id=bid))
            elif c["ai_group"] == "hybrid":
                costs.append(Cost(content_code=code, date=d, cost_type="ai_runtime", amount=round(rng.uniform(90000, 150000), -3), is_demo=True, batch_id=bid))
                costs.append(Cost(content_code=code, date=d, cost_type="other", amount=round(rng.uniform(200000, 300000), -3), is_demo=True, batch_id=bid))
            else:
                costs.append(Cost(content_code=code, date=d, cost_type="other", amount=round(rng.uniform(400000, 600000), -3), is_demo=True, batch_id=bid))
            sess = dict(content_code=code, is_demo=True, batch_id=bid)
            if ai:
                db.add(AiLiveSession(duration_min=rng.choice([120, 150, 180, 240]), questions_received=(qr := rng.randint(45, 130)),
                                     questions_answered=int(qr * rng.uniform(0.82, 0.96)), accuracy_pct=round(rng.uniform(86, 96), 1),
                                     avg_dispatch_ms=round(rng.uniform(900, 1750)), avg_e2e_ms=round(rng.uniform(2600, 4300)),
                                     interventions=rng.randint(0, 5), interruptions=rng.randint(0, 2),
                                     cost_vnd=costs[-1].amount if c["ai_group"] == "ai" else costs[-2].amount, **sess))
            else:
                db.add(AiLiveSession(duration_min=rng.choice([90, 120, 150]), questions_received=(qr := rng.randint(50, 110)),
                                     questions_answered=int(qr * rng.uniform(0.7, 0.9)), accuracy_pct=round(rng.uniform(95, 99), 1),
                                     avg_dispatch_ms=None, avg_e2e_ms=None, interventions=None, interruptions=rng.randint(0, 1),
                                     cost_vnd=costs[-1].amount, **sess))
            continue

        # ---- per-day content metrics (video/post/ad)
        tau = {"shopee_video": 12, "tiktok_aff": 7, "web_social": 7, "web_social_coupon": 7}.get(prof, 40)
        is_ad = c["kind"] == "ad"
        base = {"shopee_video": 1300, "tiktok_aff": 7000, "web_social": 3200, "web_social_coupon": 3000,
                "shopee_ad_orders": 11000, "shopee_ad_reported": 12000, "web_ad": 9000, "fb_ad_direct": 8000}[prof] * q
        ctr = {"shopee_video": (0.03, 0.07), "tiktok_aff": (0.012, 0.035), "web_social": (0.012, 0.03), "web_social_coupon": (0.012, 0.025),
               "shopee_ad_orders": (0.008, 0.013), "shopee_ad_reported": (0.007, 0.012), "web_ad": (0.009, 0.016), "fb_ad_direct": (0.009, 0.015)}[prof]
        cr = {"shopee_video": (0.05, 0.12), "tiktok_aff": (0.05, 0.11), "shopee_ad_orders": (0.04, 0.09), "shopee_ad_reported": (0.04, 0.08)}.get(prof)
        ctr_c = rng.uniform(*ctr) * (0.7 + 0.3 * q)
        cr_c = rng.uniform(*cr) if cr else None
        has_watch = prof == "shopee_video" and rng.random() < 0.7
        for n_i, d in enumerate(days):
            age = (d - c["pub"]).days
            decay = math.exp(-age / tau) if not is_ad else 1.0
            exp_d = max(0, int(rng.gauss(base * decay, base * decay * 0.12)))
            if is_ad:
                fact(code, d, "impressions", exp_d)
                clicks = int(exp_d * ctr_c * rng.uniform(0.85, 1.15))
                fact(code, d, "clicks", clicks)
                cpc = rng.uniform(3000, 5200)
                costs.append(Cost(content_code=code, date=d, cost_type="spend", amount=round(clicks * cpc, -2), is_demo=True, batch_id=bid))
                if prof == "shopee_ad_orders":
                    make_orders(c, d, _poisson(rng, clicks * cr_c), "ads_report", 7, None)
                elif prof == "shopee_ad_reported":
                    o = _poisson(rng, clicks * cr_c)
                    fact(code, d, "orders_reported", o)
                    fact(code, d, "revenue_reported", o * rng.uniform(70000, 110000))
                elif prof == "web_ad":
                    make_sessions(c, d, int(clicks * 0.65))
                continue
            fact(code, d, "views", exp_d)
            fact(code, d, "engagements", exp_d * rng.uniform(0.03, 0.08))
            if prof == "shopee_video":
                if has_watch:
                    fact(code, d, "watch_time_sec", exp_d * rng.uniform(6, 15))
                else:
                    fact(code, d, "watch_time_sec", None, "not_collected")
                fact(code, d, "product_views", None, "not_provided")
                fact(code, d, "add_to_cart", None, "not_provided")
            clicks = int(exp_d * ctr_c * rng.uniform(0.85, 1.15))
            fact(code, d, "clicks", clicks)
            if prof == "shopee_video":
                make_orders(c, d, _poisson(rng, clicks * cr_c), "shopee_report", 7, None)
            elif prof == "tiktok_aff":
                make_orders(c, d, _poisson(rng, clicks * cr_c), "affiliate_link", 7, 0.55, commission=c["commission"])
            elif prof in ("web_social", "web_social_coupon"):
                n_s = int(clicks * 0.7)
                make_sessions(c, d, n_s)
                if prof == "web_social_coupon":
                    make_orders(c, d, _poisson(rng, n_s * 0.55 * 0.30 * 0.18), "coupon_code", 3, None)

        if c["kind"] == "video" and c["platform"] == "shopee":
            ai = c["ai_group"]
            minutes = rng.uniform(20, 55) if ai == "ai" else rng.uniform(70, 120) if ai == "hybrid" else rng.uniform(180, 300)
            cost = rng.uniform(12000, 40000) if ai == "ai" else rng.uniform(80000, 160000) if ai == "hybrid" else rng.uniform(250000, 500000)
            db.add(VideoProduction(content_code=code, minutes=round(minutes), script_version=f"v{rng.randint(1, 3)}-{'pain-point' if rng.random() < .6 else 'deal'}",
                                   is_demo=True, batch_id=bid))
            costs.append(Cost(content_code=code, date=max(c["pub"], first_day), cost_type="production", amount=round(cost, -3), is_demo=True, batch_id=bid))

    # orders with an unknown source (customers who found the shop themselves): ~22% of attributed orders
    n_attr = len(orders)
    for _ in range(int(n_attr * 0.22)):
        d = first_day + timedelta(days=rng.randint(0, (last_day - first_day).days))
        make_orders({"sku": rng.choice(SKUS), "code": ""}, d, 1, None, None, None)

    # dedupe cost rows (live sessions may produce duplicate keys) by merging on the key
    merged: dict[tuple, Cost] = {}
    for cst in costs:
        k = (cst.content_code, cst.date, cst.cost_type)
        if k in merged:
            merged[k].amount += cst.amount
        else:
            merged[k] = cst
    db.add_all(facts)
    db.add_all(merged.values())
    db.add_all(orders)
    db.flush()
    db.add_all(attrs)
    db.add_all(events)

    # ---------------------------------------------------------- log chatbot demo
    qa = [("Bánh tráng này cay không shop?", "INTENT_PRODUCT_INFO"), ("Hạn sử dụng bao lâu vậy?", "INTENT_SHELF_LIFE"),
          ("Giá flash sale hôm nay bao nhiêu?", "INTENT_PRICE_PROMO"), ("Còn hàng gói extra cay không?", "INTENT_STOCK_STATUS"),
          ("Có ship ra Đà Nẵng không?", "INTENT_OTHER"), ("Ăn có dị ứng tôm không ạ?", "INTENT_OTHER")]
    weights = [0.30, 0.17, 0.22, 0.17, 0.10, 0.04]
    for _ in range(340):
        text, intent = rng.choices(qa, weights)[0]
        d = last_day - timedelta(days=rng.randint(0, 29))
        ts = datetime.combine(d, datetime.min.time()) + timedelta(seconds=rng.randint(8 * 3600, 23 * 3600))
        other = intent == "INTENT_OTHER"
        handoff = other and rng.random() < 0.6 or rng.random() < 0.03
        db.add(ChatLog(ts=ts, session_id=f"demo-c{rng.randint(1, 200)}", sku=rng.choice(SKUS), question=text, intent=intent,
                       answer="(demo)", latency_ms=round(rng.lognormvariate(math.log(2100), 0.3)), handoff=handoff,
                       clicked_buy=(not handoff and not other and rng.random() < 0.14),
                       cost_vnd=round(rng.uniform(40, 120), 1), correct=(rng.random() < 0.94) if rng.random() < 0.45 else None, is_demo=True))

    batch.rows_ok = len(facts) + len(orders)
    db.commit()
    return True
