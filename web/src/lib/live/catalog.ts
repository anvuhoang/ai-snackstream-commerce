import { errorText } from "@/lib/errors";

export function liveCatalogError(body: unknown): string {
  const code = (body as { error?: { code?: string } } | undefined)?.error?.code;
  if (code === "live_catalog_unavailable") return "Chưa đọc được dữ liệu sản phẩm. Vui lòng thử lại sau.";
  if (code === "live_product_incomplete") return "Sản phẩm chưa có đủ thông tin để trả lời.";
  if (code === "host_audio_controls_sku" || code === "live_playlist_controls_sku") return "Chỉ ghim sản phẩm đang được giới thiệu; thao tác này không đổi lời dẫn.";
  return errorText(body);
}
