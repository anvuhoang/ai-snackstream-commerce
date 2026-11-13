import type { components } from "@/lib/api/schema";

type Schemas = components["schemas"];
export type Overview = Schemas["Overview"];
export type FunnelStep = Schemas["FunnelStep"];
export type SourceRow = Schemas["SourceRow"];
export type ProductRow = Schemas["ProductRow"];
export type DemoFilter = Overview["demo"];

export const DEMO_OPTIONS: { value: DemoFilter; label: string }[] = [
  { value: "exclude", label: "Chỉ dữ liệu thật" },
  { value: "include", label: "Gồm cả demo" },
  { value: "only", label: "Chỉ demo" },
];

export const STEP_LABEL: Record<FunnelStep["key"], string> = {
  product_view: "Xem sản phẩm",
  add_to_cart: "Thêm vào giỏ",
  checkout_started: "Vào trang thanh toán",
  order_created: "Đơn được tạo",
  order_completed: "Đơn hoàn tất",
};

/** Fraction → "12,5%". The caller decides what to show when it is null (it can never be silently zero). */
export function formatPercent(rate: number): string {
  return `${(rate * 100).toLocaleString("vi-VN", { maximumFractionDigits: 1 })}%`;
}

export const sourceLabel = (source: string) => (source === "" ? "Trực tiếp (không có UTM)" : source);

const DATE = /^\d{4}-\d{2}-\d{2}$/;
export const isDate = (s: string | undefined): s is string => !!s && DATE.test(s) && !Number.isNaN(Date.parse(s));

/** Today's date in Vietnam (the dashboard counts Vietnam calendar days), as YYYY-MM-DD. */
export function todayVn(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Ho_Chi_Minh" }).format(new Date());
}

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export type ChannelRow = Schemas["ChannelRow"];
export type ChannelsOut = Schemas["ChannelsOut"];
export type ShopeeOut = Schemas["ShopeeOut"];
export type AiOut = Schemas["AiOut"];
export type BatchOut = Schemas["BatchOut"];

export type TabKey = "overview" | "channels" | "shopee" | "ai" | "data";
export const TABS: { key: TabKey; label: string }[] = [
  { key: "overview", label: "Tổng quan" },
  { key: "channels", label: "Kênh ngoài" },
  { key: "shopee", label: "Shopee" },
  { key: "ai", label: "Chatbot và Live" },
  { key: "data", label: "Dữ liệu" },
];
export const isTab = (s: string | undefined): s is TabKey => TABS.some((t) => t.key === s);

/** A number that may not have been reported: "—" means "not reported", never 0. */
export const orDash = (n: number | null | undefined, fmt: (n: number) => string = (x) => x.toLocaleString("vi-VN")) => (n === null || n === undefined ? "—" : fmt(n));

export const RATIO_NOTE: Record<"ok" | "no_data" | "no_denominator", string> = {
  ok: "",
  no_data: "Chưa đủ dữ liệu",
  no_denominator: "Không tính được",
};

export const CSV_TEMPLATE = [
  "date,channel,content,views,impressions,clicks,orders,revenue,cost",
  "2026-11-02,tiktok,clip-01,1200,,90,6,540000,200000",
  "2026-11-02,shopee,,,,,4,380000,",
  "",
].join("\n");
