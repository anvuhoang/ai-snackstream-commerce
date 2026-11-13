"""Numbers that other channels report (imported or typed in), shown next to the web's own numbers but never mixed into them.

Same rules as report.py: a value nobody reported is None (never 0); a ratio uses only the days that report BOTH of its numbers;
a zero or missing denominator is "cannot be computed". Orders and revenue that a channel reports are the channel's claim, kept
apart from the orders the web recorded, so one order can never be counted twice.
"""

from __future__ import annotations

from collections import defaultdict
from datetime import date

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .models import ChannelMetric, Event
from .report import _scope, day_bounds
from .schemas import AiOut, ChannelRow, ChannelsOut, ShopeeOut


def _filter(stmt, date_from: date, date_to: date, demo: str, channel: str | None):
    stmt = stmt.where(ChannelMetric.day >= date_from, ChannelMetric.day <= date_to)
    if demo == "exclude":
        stmt = stmt.where(ChannelMetric.is_demo.is_(False))
    elif demo == "only":
        stmt = stmt.where(ChannelMetric.is_demo.is_(True))
    if channel:
        stmt = stmt.where(ChannelMetric.channel == channel)
    return stmt


def _ratio(cells: list[dict[str, int]], num: str, den: str) -> tuple[float | None, str]:
    """num / den summed over the cells (a day on a channel, for one content) that have both."""
    both = [c for c in cells if num in c and den in c]
    if not both:
        return None, "no_data"
    d = sum(c[den] for c in both)
    if d == 0:
        return None, "no_denominator"
    return sum(c[num] for c in both) / d, "ok"


def channels(
    db: Session, date_from: date, date_to: date, demo: str, channel: str | None = None
) -> ChannelsOut:
    rows = db.execute(_filter(select(ChannelMetric), date_from, date_to, demo, channel)).scalars().all()
    cells: dict[str, dict[tuple, dict[str, int]]] = defaultdict(lambda: defaultdict(dict))
    days: dict[str, set[date]] = defaultdict(set)
    for r in rows:
        cells[r.channel][(r.day, r.content_code)][r.metric] = r.value
        days[r.channel].add(r.day)
    out: list[ChannelRow] = []
    for name in sorted(cells):
        per = list(cells[name].values())
        sums = {
            m: (sum(c[m] for c in per if m in c) if any(m in c for c in per) else None)
            for m in ("views", "impressions", "clicks", "orders", "revenue_vnd", "cost_vnd")
        }
        ctr, ctr_note = _ratio(per, "clicks", "views")
        cpo, cpo_note = _ratio(per, "cost_vnd", "orders")
        out.append(
            ChannelRow(
                channel=name,
                ctr=ctr,
                ctr_note=ctr_note,  # type: ignore[arg-type]
                cost_per_order_vnd=None if cpo is None else round(cpo),
                cost_per_order_note=cpo_note,  # type: ignore[arg-type]
                days=len(days[name]),
                **sums,
            )
        )
    # biggest spenders / sellers first, so the table reads top-down
    out.sort(key=lambda r: (-(r.revenue_vnd or 0), -(r.views or 0), r.channel))
    return ChannelsOut(date_from=date_from, date_to=date_to, demo=demo, rows=out)  # type: ignore[arg-type]


def shopee(db: Session, date_from: date, date_to: date, demo: str) -> ShopeeOut:
    start, end = day_bounds(date_from, date_to)
    web_clicks = (
        db.scalar(
            _scope(select(func.count(Event.id)).where(Event.name == "shopee_click"), start, end, demo, None)
        )
        or 0
    )
    rows = channels(db, date_from, date_to, demo, "shopee").rows
    return ShopeeOut(
        date_from=date_from,
        date_to=date_to,
        demo=demo,  # type: ignore[arg-type]
        web_clicks=int(web_clicks),
        reported=rows[0] if rows else None,
    )


AI_EVENTS = ("chat_question", "live_join", "live_product_click")


def ai(db: Session, date_from: date, date_to: date, demo: str) -> AiOut:
    """What the chatbot and live host brought in. The events come from P5 and P6; until they send any, `collected` is False."""
    start, end = day_bounds(date_from, date_to)

    def count(name: str, distinct_sessions: bool = False) -> int:
        col = func.count(func.distinct(Event.session_id)) if distinct_sessions else func.count(Event.id)
        return int(db.scalar(_scope(select(col).where(Event.name == name), start, end, demo, None)) or 0)

    ever = db.scalar(select(func.count(Event.id)).where(Event.name.in_(AI_EVENTS))) or 0
    return AiOut(
        date_from=date_from,
        date_to=date_to,
        demo=demo,  # type: ignore[arg-type]
        chat_questions=count("chat_question"),
        chat_sessions=count("chat_question", distinct_sessions=True),
        live_joins=count("live_join"),
        live_product_clicks=count("live_product_click"),
        collected=ever > 0,
    )
