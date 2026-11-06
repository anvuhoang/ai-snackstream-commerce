// Display labels. Mirrors apps/api/app/config.py; the API (/api/meta) remains the source of truth.
export const PLATFORMS: Record<string, string> = { shopee: "Shopee", tiktok: "TikTok", facebook: "Facebook", website: "Website" };
export const KINDS: Record<string, string> = { video: "Video", post: "Bài đăng", live: "Phiên live", ad: "Quảng cáo", shop: "Gian hàng/SKU" };
export const DISTS: Record<string, string> = { organic: "Tự nhiên", paid: "Quảng cáo trả phí", affiliate: "Affiliate (KOL/KOC)" };
export const DESTS: Record<string, string> = { shopee: "Thẳng Shopee", website: "Qua website nhóm" };
export const AIG: Record<string, string> = { ai: "AI", human: "Người thực hiện", hybrid: "Kết hợp" };
export const LEVELS: Record<string, string> = { awareness: "Biết đến", click: "Biết click", visit: "Biết lượt đến", order: "Xác định được đơn" };
export const MODES: Record<string, string> = { all: "Tất cả", real: "Dữ liệu thật", demo: "Dữ liệu demo" };
export const STATUS_LABEL: Record<string, string> = {
  value: "Có dữ liệu", not_collected: "Chưa có dữ liệu", not_connected: "Chưa kết nối",
  not_provided: "Nguồn không cung cấp", undetermined: "Không xác định được",
};
export const METRIC_KEYS: Record<string, string> = {
  views: "Lượt xem", impressions: "Lượt hiển thị", engagements: "Tương tác", comments: "Bình luận", watch_time_sec: "Tổng thời gian xem (giây)",
  clicks: "Click", product_views: "Lượt xem sản phẩm", add_to_cart: "Thêm giỏ hàng", orders_reported: "Đơn (báo cáo tổng hợp)",
  revenue_reported: "Doanh thu (báo cáo tổng hợp)",
};
export const TARGETS = {
  ctr: { min: 0.8, max: 1.2 }, cpc: { max: 5000 }, roas: { min: 2.8, max: 4.5 }, cac: { max: 50000 }, dispatch: { max: 1500 }, e2e: { max: 3500 },
};

/** "ok" | "good" | "bad" | "" for a value compared with the proposal targets. */
export function targetState(key: keyof typeof TARGETS, v: number | null | undefined): "ok" | "good" | "bad" | "" {
  if (v == null) return "";
  const t = TARGETS[key] as { min?: number; max?: number };
  if (key === "cac" || key === "dispatch" || key === "e2e" || key === "cpc") return v <= (t.max as number) ? "ok" : "bad";
  if (t.min != null && v < t.min) return "bad";
  if (t.max != null && v > t.max) return "good";
  return "ok";
}
