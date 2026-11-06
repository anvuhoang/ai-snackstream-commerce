"""AI performance analysis: AI video, chatbot, AI live, and AI vs human vs hybrid comparison."""
from __future__ import annotations

from datetime import datetime, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from . import config
from .analytics import Filters, Row, _mode_filter, summarize
from .metrics import Agg, Ratio, safe_ratio
from .models import AiLiveSession, ChatLog, VideoProduction

INTENT_LABEL = {
    "INTENT_PRODUCT_INFO": "Thông tin sản phẩm",
    "INTENT_SHELF_LIFE": "Hạn sử dụng",
    "INTENT_PRICE_PROMO": "Giá / khuyến mãi",
    "INTENT_STOCK_STATUS": "Tồn kho",
    "INTENT_OTHER": "Khác (chuyển người / chat-only)",
}


def _pctile(values: list[float], p: float) -> float | None:
    if not values:
        return None
    v = sorted(values)
    k = (len(v) - 1) * p
    lo, hi = int(k), min(int(k) + 1, len(v) - 1)
    return v[lo] + (v[hi] - v[lo]) * (k - lo)


def chat_stats(db: Session, f: Filters) -> dict:
    start = datetime.combine(f.date_from, datetime.min.time())
    end = datetime.combine(f.date_to + timedelta(days=1), datetime.min.time())
    q = select(ChatLog).where(ChatLog.ts >= start, ChatLog.ts < end)
    if (cond := _mode_filter(ChatLog.is_demo, f.mode)) is not None:
        q = q.where(cond)
    if f.sku:
        q = q.where(ChatLog.sku == f.sku)
    logs = list(db.scalars(q))
    n = len(logs)
    lat = [x.latency_ms for x in logs if x.latency_ms is not None]
    reviewed = [x for x in logs if x.correct is not None]
    by_intent: dict[str, dict] = {}
    for x in logs:
        d = by_intent.setdefault(x.intent, {"n": 0, "handoff": 0, "reviewed": 0, "correct": 0, "buy": 0})
        d["n"] += 1
        d["handoff"] += x.handoff
        d["buy"] += x.clicked_buy
        if x.correct is not None:
            d["reviewed"] += 1
            d["correct"] += 1 if x.correct else 0
    costs = [x.cost_vnd for x in logs if x.cost_vnd is not None]
    return {
        "n": n,
        "sessions": len({x.session_id for x in logs}),
        "resolved": safe_ratio(n - sum(x.handoff for x in logs), n) if n else Ratio(None, "Chưa có câu hỏi nào"),
        "handoff": safe_ratio(sum(x.handoff for x in logs), n) if n else Ratio(None, "Chưa có câu hỏi nào"),
        "accuracy": safe_ratio(sum(1 for x in reviewed if x.correct), len(reviewed)) if reviewed else Ratio(None, "Chưa có câu nào được kiểm tra"),
        "reviewed": len(reviewed),
        "avg_latency": (sum(lat) / len(lat)) if lat else None,
        "p95_latency": _pctile(lat, 0.95),
        "buy": safe_ratio(sum(x.clicked_buy for x in logs), n) if n else Ratio(None, "Chưa có câu hỏi nào"),
        "cost": sum(costs) if costs else None,
        "cost_per_q": (sum(costs) / len(costs)) if costs else None,
        "by_intent": [{"intent": k, "label": INTENT_LABEL.get(k, k), **v,
                       "handoff_rate": safe_ratio(v["handoff"], v["n"]),
                       "accuracy": safe_ratio(v["correct"], v["reviewed"]) if v["reviewed"] else Ratio(None, "Chưa kiểm tra")}
                      for k, v in sorted(by_intent.items(), key=lambda kv: -kv[1]["n"])],
    }


def live_sessions(db: Session, rows: list[Row]) -> list[dict]:
    live = [r for r in rows if r.c.kind == "live"]
    sess = {s.content_code: s for s in db.scalars(select(AiLiveSession).where(AiLiveSession.content_code.in_([r.c.code for r in live])))} if live else {}
    out = []
    for r in live:
        s = sess.get(r.c.code)
        recv = s.questions_received if s else None
        ans = s.questions_answered if s else None
        out.append({"r": r, "s": s,
                    "answer_rate": safe_ratio(ans, recv) if s and recv is not None and ans is not None else Ratio(None, "Thiếu log"),
                    "per_1000": r.r_orders_per_1000()})
    return out


def video_ai(db: Session, rows: list[Row]) -> list[dict]:
    vids = [r for r in rows if r.c.kind == "video" and r.c.platform == "shopee"]
    prod = {p.content_code: p for p in db.scalars(select(VideoProduction).where(VideoProduction.content_code.in_([r.c.code for r in vids])))} if vids else {}
    return [{"r": r, "p": prod.get(r.c.code), "prod_cost": r.cost.get("production")} for r in vids]


def group_compare(rows: list[Row], db: Session) -> list[dict]:
    scope = [r for r in rows if r.c.kind in ("video", "live") and r.c.platform == "shopee"]
    prod = {p.content_code: p.minutes for p in db.scalars(select(VideoProduction))} if scope else {}
    out = []
    for g, label in config.AI_GROUPS.items():
        rs = [r for r in scope if r.c.ai_group == g]
        s = summarize(rs) if rs else None
        mins = [prod[r.c.code] for r in rs if r.c.code in prod and prod[r.c.code] is not None]
        out.append({"group": g, "label": label, "n": len(rs), "s": s,
                    "avg_minutes": (sum(mins) / len(mins)) if mins else None,
                    "enough": len(rs) >= 5})
    return out
