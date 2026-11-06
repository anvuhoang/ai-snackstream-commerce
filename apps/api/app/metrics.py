"""Metric computation core. Every formula and every "cannot be computed" rule lives here, shared by the UI, exports and tests.

Rules:
- A missing value is NEVER treated as 0. Agg.value=None carries a status instead.
- Ratios use only the contents that have BOTH numerator and denominator (same measurement scope).
- Denominator = 0 => "cannot be computed".
"""
from __future__ import annotations

from collections import Counter
from dataclasses import dataclass, field
from typing import Callable, Iterable

STATUS_LABEL = {
    "value": "Có dữ liệu",
    "not_collected": "Chưa có dữ liệu",
    "not_connected": "Chưa kết nối",
    "not_provided": "Nguồn không cung cấp",
    "undetermined": "Không xác định được",
}
VALID_AVAILABILITY = ("value", "not_collected", "not_connected", "not_provided")

# Keys of the daily metrics (metric_fact.metric_key)
METRIC_KEYS = {
    "views": "Lượt xem",
    "impressions": "Lượt hiển thị",
    "engagements": "Tương tác",
    "comments": "Bình luận",
    "watch_time_sec": "Tổng thời gian xem (giây)",
    "clicks": "Click",
    "product_views": "Lượt xem sản phẩm",
    "add_to_cart": "Thêm giỏ hàng",
    "orders_reported": "Đơn (báo cáo tổng hợp)",
    "revenue_reported": "Doanh thu (báo cáo tổng hợp)",
}


@dataclass
class Agg:
    value: float | None
    status: str = "value"  # khi value is None
    n_known: int = 1
    n_total: int = 1
    note: str = ""
    basis: str = ""  # order_level | reported

    @property
    def known(self) -> bool:
        return self.value is not None

    @classmethod
    def missing(cls, status: str = "not_collected", note: str = "") -> "Agg":
        return cls(None, status, 0, 1, note)

    @property
    def label(self) -> str:
        return STATUS_LABEL.get(self.status, self.status)


def sum_aggs(aggs: Iterable[Agg]) -> Agg:
    aggs = list(aggs)
    if not aggs:
        return Agg(None, "not_collected", 0, 0)
    known = [a.value for a in aggs if a.value is not None]
    if known:
        return Agg(sum(known), "value", len(known), len(aggs))
    common = Counter(a.status for a in aggs).most_common(1)[0][0]
    return Agg(None, common, 0, len(aggs))


@dataclass
class Ratio:
    value: float | None
    reason: str = ""
    n_used: int = 0
    n_total: int = 0
    num: float = 0.0
    den: float = 0.0

    @property
    def known(self) -> bool:
        return self.value is not None

    @property
    def partial(self) -> bool:
        return self.known and self.n_used < self.n_total


def ratio_over(items: list, num_fn: Callable, den_fn: Callable, scale: float = 100.0) -> Ratio:
    """Numerator / denominator over only the items that have both (same measurement scope)."""
    used, n, d = 0, 0.0, 0.0
    for it in items:
        a, b = num_fn(it), den_fn(it)
        if a.value is None or b.value is None:
            continue
        used += 1
        n += a.value
        d += b.value
    total = len(items)
    if total == 0:
        return Ratio(None, "Không có nội dung nào trong phạm vi lọc", 0, 0)
    if used == 0:
        return Ratio(None, "Thiếu dữ liệu tử số hoặc mẫu số", 0, total)
    if d == 0:
        return Ratio(None, "Mẫu số bằng 0", used, total, n, d)
    return Ratio(n / d * scale, "", used, total, n, d)


def safe_ratio(num: float | None, den: float | None, scale: float = 100.0) -> Ratio:
    if num is None or den is None:
        return Ratio(None, "Thiếu dữ liệu tử số hoặc mẫu số")
    if den == 0:
        return Ratio(None, "Mẫu số bằng 0", 1, 1, num, den)
    return Ratio(num / den * scale, "", 1, 1, num, den)


# ---- Metric definitions (shown on the /metrics page, to be confirmed with Viet) ----
METRIC_DEFS = [
    {"key": "ctr_ad", "label": "CTR quảng cáo", "formula": "Click quảng cáo ÷ Lượt hiển thị quảng cáo × 100%",
     "scope": "Chỉ nội dung loại Quảng cáo", "needs": "clicks, impressions", "unit": "%"},
    {"key": "click_per_view", "label": "Tỷ lệ click trên lượt xem", "formula": "Click liên quan ÷ Lượt xem nội dung × 100%",
     "scope": "Video, bài đăng, phiên live (không phải quảng cáo)", "needs": "clicks, views", "unit": "%"},
    {"key": "order_per_click", "label": "Tỷ lệ đơn trên click", "formula": "Đơn được ghi nhận cho nguồn ÷ Click tương ứng × 100%",
     "scope": "Nội dung xác định được đơn", "needs": "orders, clicks", "unit": "%"},
    {"key": "order_per_view", "label": "Tỷ lệ đơn trên lượt xem", "formula": "Đơn được ghi nhận cho nguồn ÷ Lượt xem nội dung × 100%",
     "scope": "Nội dung xác định được đơn", "needs": "orders, views", "unit": "%"},
    {"key": "clicks_per_1000", "label": "Click trên 1.000 lượt xem", "formula": "Click ÷ Lượt xem × 1.000",
     "scope": "Chỉ khi click và lượt xem cùng phạm vi đo", "needs": "clicks, views", "unit": ""},
    {"key": "orders_per_1000", "label": "Đơn trên 1.000 lượt xem", "formula": "Đơn được ghi nhận ÷ Lượt xem × 1.000",
     "scope": "Chỉ khi đơn và lượt xem cùng phạm vi đo", "needs": "orders, views", "unit": ""},
    {"key": "roas", "label": "ROAS", "formula": "Doanh thu được quy cho quảng cáo ÷ Chi phí quảng cáo",
     "scope": "Nội dung trả phí có chi phí quảng cáo", "needs": "revenue, spend", "unit": "x"},
    {"key": "cost_per_order", "label": "Chi phí / đơn", "formula": "Tổng chi phí ghi nhận ÷ Số đơn được quy",
     "scope": "Dùng khi chưa xác định được khách hàng mới", "needs": "cost, orders", "unit": "đ"},
    {"key": "cac", "label": "CAC", "formula": "Chi phí thu hút khách đã xác định ÷ Số khách hàng mới được xác định",
     "scope": "Chỉ khi nguồn cho biết khách mới; nếu không hiển thị Chi phí/đơn", "needs": "cost, new_customers", "unit": "đ"},
    {"key": "cpc", "label": "CPC", "formula": "Chi phí quảng cáo ÷ Click quảng cáo",
     "scope": "Nội dung loại Quảng cáo", "needs": "spend, clicks", "unit": "đ"},
]


# ---- Display formatting (Vietnamese style: '.' thousands separator, ',' decimal) ----
def fmt_int(v: float | None) -> str:
    if v is None:
        return "—"
    return f"{v:,.0f}".replace(",", ".")


def fmt_dec(v: float | None, digits: int = 2) -> str:
    if v is None:
        return "—"
    return f"{v:,.{digits}f}".replace(",", "X").replace(".", ",").replace("X", ".")


def fmt_pct(v: float | None, digits: int = 2) -> str:
    return "—" if v is None else f"{fmt_dec(v, digits)}%"


def fmt_vnd(v: float | None) -> str:
    return "—" if v is None else f"{fmt_int(v)}đ"


def fmt_compact(v: float | None) -> str:
    if v is None:
        return "—"
    a = abs(v)
    if a >= 1e9:
        return f"{fmt_dec(v / 1e9, 2)} tỷ"
    if a >= 1e6:
        return f"{fmt_dec(v / 1e6, 2)} tr"
    if a >= 1e3:
        return f"{fmt_dec(v / 1e3, 1)}k"
    return fmt_int(v)
