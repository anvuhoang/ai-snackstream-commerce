/**
 * The API returns stable error codes ({"error": {"code", "message", "details"?}}); the message is English and meant for
 * logs. What the visitor reads comes from this table. Add a line when an endpoint adds a code.
 */
const MESSAGES: Record<string, string> = {
  not_authenticated: "Vui lòng đăng nhập.",
  invalid_credentials: "Sai e-mail hoặc mật khẩu.",
  too_many_attempts: "Bạn thử sai quá nhiều lần. Vui lòng chờ vài phút rồi thử lại.",
  csrf_invalid: "Phiên làm việc đã hết hạn. Hãy tải lại trang và thử lại.",
  forbidden: "Bạn không có quyền thực hiện thao tác này.",
  product_not_found: "Không tìm thấy sản phẩm.",
  category_not_found: "Danh mục không tồn tại.",
  category_exists: "Đã có danh mục trùng tên.",
  duplicate_sku: "Hai biến thể đang dùng cùng một mã SKU.",
  invalid_compare_at: "Giá gốc phải cao hơn giá bán.",
  file_too_large: "Ảnh quá lớn (tối đa 5 MB).",
  unsupported_image_type: "Chỉ nhận ảnh JPEG, PNG hoặc WebP.",
  variant_not_found: "Không tìm thấy biến thể.",
  image_not_found: "Không tìm thấy ảnh.",
  conflict: "Giá trị này đã được dùng.",
};

/** What a product still needs before it can be put on sale (the API's `details.missing` values). */
export const PUBLISH_MISSING: Record<string, string> = {
  category: "chọn danh mục",
  ingredients: "nhập thành phần",
  storage: "nhập hướng dẫn bảo quản",
  ingredients_verified: "xác nhận thành phần đã được kiểm tra",
  active_variant: "có ít nhất một biến thể đang bán với giá lớn hơn 0",
};

export const GENERIC_ERROR = "Có lỗi xảy ra. Vui lòng thử lại.";

type ApiError = { error?: { code?: string; details?: { missing?: string[]; skus?: string[] } } };

/** Turn an API error body (or anything thrown) into text for the visitor. */
export function errorText(body: unknown): string {
  const error = (body as ApiError | undefined)?.error;
  const code = error?.code;
  if (code === "publish_requirements_not_met") {
    const todo = (error?.details?.missing ?? []).map((m) => PUBLISH_MISSING[m] ?? m);
    return todo.length ? `Chưa thể đăng bán. Cần: ${todo.join("; ")}.` : "Chưa thể đăng bán sản phẩm này.";
  }
  if (code === "sku_taken") {
    const skus = error?.details?.skus?.join(", ");
    return skus ? `Mã SKU đã được dùng: ${skus}.` : "Mã SKU đã được dùng.";
  }
  return (code && MESSAGES[code]) || GENERIC_ERROR;
}
