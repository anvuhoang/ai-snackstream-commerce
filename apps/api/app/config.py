import os
from pathlib import Path

from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent.parent
load_dotenv(BASE_DIR / ".env")

def _db_url() -> str:
    url = os.getenv("DATABASE_URL", "").strip()
    if not url:
        return f"sqlite:///{BASE_DIR / 'snackstream_dev.db'}"
    # hosting providers (Render, Railway, Heroku...) usually hand out postgres:// or postgresql://
    for prefix in ("postgres://", "postgresql://"):
        if url.startswith(prefix):
            return "postgresql+psycopg://" + url[len(prefix):]
    return url


DATABASE_URL = _db_url()
APP_ENV = os.getenv("APP_ENV", "dev")  # dev | production
IS_PROD = APP_ENV == "production"
SEED_DEMO = os.getenv("SEED_DEMO", "") == "1"  # seed demo data on first start (to demo a deployment)
SECRET_KEY = os.getenv("SECRET_KEY", "dev-only-secret-change-me")
ADMIN_USER = os.getenv("ADMIN_USER", "admin")
ADMIN_PASSWORD = os.getenv("ADMIN_PASSWORD", "admin123")
ADMIN_PASSWORD_HASH = os.getenv("ADMIN_PASSWORD_HASH", "")
INGEST_TOKEN = os.getenv("INGEST_TOKEN", "")

# Platforms / content kinds / distribution
PLATFORMS = {"shopee": "Shopee", "tiktok": "TikTok", "facebook": "Facebook", "website": "Website"}
CONTENT_KINDS = {"video": "Video", "post": "Bài đăng", "live": "Phiên live", "ad": "Quảng cáo", "shop": "Gian hàng/SKU"}
DISTRIBUTIONS = {"organic": "Tự nhiên", "paid": "Quảng cáo trả phí", "affiliate": "Affiliate (KOL/KOC)"}
DESTINATIONS = {"shopee": "Thẳng Shopee", "website": "Qua website nhóm"}
AI_GROUPS = {"ai": "AI", "human": "Người thực hiện", "hybrid": "Kết hợp"}
ATTRIBUTION_LEVELS = {
    "awareness": "Biết đến",
    "click": "Biết click",
    "visit": "Biết lượt đến",
    "order": "Xác định được đơn",
}
ORDER_STATUSES = {"pending": "Chờ xử lý", "shipping": "Đang giao", "completed": "Hoàn tất", "cancelled": "Đã hủy", "returned": "Hoàn trả"}
# Order statuses counted toward revenue/conversion (shown in the UI)
COUNTED_STATUSES = ("shipping", "completed")
COST_TYPES = {
    "spend": "Chi phí quảng cáo",
    "commission": "Hoa hồng affiliate",
    "production": "Chi phí sản xuất",
    "ai_runtime": "Chi phí chạy AI",
    "other": "Khác",
}
ATTRIBUTION_METHODS = {
    "shopee_report": "Báo cáo Shopee (Live/Video)",
    "ads_report": "Báo cáo Shopee Ads",
    "affiliate_link": "Link Shopee Affiliate",
    "coupon_code": "Mã giảm giá riêng",
    "utm_web": "UTM trên website",
    "manual": "Nhập tay có nguồn",
}

# KPI targets from the proposal (Table 6) + AI Live latency targets (section 3.2.2.3)
KPI_TARGETS = {
    "ctr_ad": {"label": "CTR quảng cáo", "min": 0.8, "max": 1.2, "unit": "%"},
    "cpc": {"label": "CPC", "min": 3000, "max": 5000, "unit": "đ"},
    "roas": {"label": "ROAS", "min": 2.8, "max": 4.5, "unit": "x"},
    "cac": {"label": "CAC", "max": 50000, "unit": "đ"},
    "dispatch_ms": {"label": "Độ trễ dispatch", "max": 1500, "unit": "ms"},
    "e2e_ms": {"label": "Độ trễ end-to-end", "max": 3500, "unit": "ms"},
}

# Data sources and their real connection status (update once Viet verifies API access)
SOURCES = [
    {"key": "shopee", "name": "Shopee (báo cáo Live/Video/Ads/Đơn)", "platform": "shopee", "api": "not_connected",
     "note": "Chưa xác minh API công khai — nhập bằng CSV/Excel."},
    {"key": "tiktok", "name": "TikTok (bài/video, Affiliate)", "platform": "tiktok", "api": "not_connected",
     "note": "Pixel chỉ hoạt động với Spark Ads; đơn đo qua link Affiliate."},
    {"key": "facebook", "name": "Facebook (bài/quảng cáo)", "platform": "facebook", "api": "not_connected",
     "note": "Chưa kết nối — nhập bằng CSV/Excel."},
    {"key": "website", "name": "Website nhóm (sự kiện truy cập)", "platform": "website", "api": "connected",
     "note": "Phiên, xem sản phẩm, click sang Shopee ghi trực tiếp vào hệ thống."},
    {"key": "odoo", "name": "Odoo ERP (sản phẩm, tồn kho)", "platform": None, "api": "not_connected",
     "note": "Đang dùng dữ liệu sản phẩm thử có nhãn."},
    {"key": "make", "name": "Make.com webhook", "platform": None, "api": "not_connected",
     "note": "Cấu hình INGEST_TOKEN để bật."},
]
