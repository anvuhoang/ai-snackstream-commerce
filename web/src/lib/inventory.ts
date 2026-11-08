import type { components } from "@/lib/api/schema";

type Schemas = components["schemas"];
export type StockRow = Schemas["StockRow"];
export type StockPage = Schemas["StockPage"];
export type SyncStatus = Schemas["SyncStatus"];
export type SyncRun = NonNullable<SyncStatus["lastRun"]>;
export type Movement = Schemas["MovementOut"];
export type StockState = "untracked" | "out" | "low";

export const STOCK_STATES: { value: StockState | undefined; label: string }[] = [
  { value: undefined, label: "Tất cả" },
  { value: "low", label: "Sắp hết" },
  { value: "out", label: "Hết hàng" },
  { value: "untracked", label: "Chưa theo dõi" },
];

export const SOURCE_LABEL = { own: "Nhập tay", odoo: "Odoo" } as const;

export const MOVEMENT_LABEL: Record<string, string> = {
  receive: "Nhập hàng",
  adjust: "Điều chỉnh",
  reserve: "Giữ chỗ cho đơn",
  release: "Trả giữ chỗ",
  ship: "Xuất kho giao hàng",
  return: "Hàng trả về kho",
  sync: "Đồng bộ Odoo",
};
