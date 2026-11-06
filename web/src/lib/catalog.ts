import type { components } from "@/lib/api/schema";

// Catalog types come straight from the API contract, so they cannot drift from the backend.
type Schemas = components["schemas"];
export type ProductCard = Schemas["ProductCard"];
export type ProductDetail = Schemas["ProductDetail"];
export type CategoryOut = Schemas["CategoryOut"];
export type ImageOut = Schemas["ImageOut"];
export type AdminProduct = Schemas["AdminProduct"];
export type AdminProductRow = Schemas["AdminProductRow"];
export type AdminVariant = Schemas["AdminVariant"];
export type AdminCategory = Schemas["AdminCategory"];
export type ProductStatus = AdminProduct["status"];

export const SORTS = [
  { key: "newest", label: "Mới nhất" },
  { key: "price_asc", label: "Giá tăng dần" },
  { key: "price_desc", label: "Giá giảm dần" },
  { key: "name", label: "Tên A–Z" },
] as const;
export type SortKey = (typeof SORTS)[number]["key"];
export const isSortKey = (v: string | undefined): v is SortKey => SORTS.some((s) => s.key === v);

export const STATUS_LABEL: Record<ProductStatus, string> = { draft: "Nháp", published: "Đang bán", hidden: "Đã ẩn" };

/** Build "?a=1&b=2" from the defined, non-empty values. */
export function query(params: Record<string, string | number | undefined>): string {
  const q = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value !== undefined && value !== "") q.set(key, String(value));
  const s = q.toString();
  return s ? `?${s}` : "";
}
