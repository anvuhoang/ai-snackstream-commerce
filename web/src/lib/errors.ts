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
  variant_unavailable: "Sản phẩm này hiện không còn bán.",
  cart_item_not_found: "Sản phẩm không có trong giỏ hàng.",
  cart_empty: "Giỏ hàng của bạn đang trống.",
  item_unavailable: "Có sản phẩm trong giỏ không còn bán. Hãy xóa sản phẩm đó rồi thử lại.",
  idempotency_key_reused: "Đơn hàng này đã được gửi với nội dung khác. Hãy tải lại trang và thử lại.",
  payment_method_unavailable: "Hiện chưa hỗ trợ thanh toán trực tuyến. Vui lòng chọn thanh toán khi nhận hàng.",
  order_not_found: "Không tìm thấy đơn hàng với mã và số điện thoại này.",
  invalid_transition: "Không thể chuyển đơn sang trạng thái này.",
  payment_not_received: "Chưa nhận được thanh toán online của đơn này.",
  out_of_stock: "Có sản phẩm vừa hết hàng hoặc không đủ số lượng. Hãy giảm số lượng hoặc xóa sản phẩm đó rồi thử lại.",
  below_reserved: "Các đơn đang mở đã giữ nhiều hơn số này. Hãy hủy bớt đơn hoặc nhập số lớn hơn.",
  managed_by_odoo: "Số tồn này lấy từ Odoo. Hãy đổi trong Odoo rồi đồng bộ lại.",
  odoo_not_configured: "Chưa cấu hình kết nối Odoo.",
  stock_unknown: "Shop chưa xác nhận được tồn kho của món này. Vui lòng liên hệ shop.",
  import_duplicate: "File hoặc dòng nhập này đã được thêm trước đó. Muốn thêm lại, hãy xóa lần nhập cũ trước.",
  csv_invalid_rows: "Có dòng bị lỗi nên chưa có gì được nhập. Sửa file rồi thử lại.",
  csv_columns: "Dòng đầu của file phải ghi tên cột: date, channel và ít nhất một số liệu (views, clicks, orders, revenue, cost).",
  csv_empty: "File không có dòng dữ liệu nào.",
  csv_unreadable: "Không đọc được file. Hãy lưu thành CSV (UTF-8) rồi thử lại.",
  too_many_rows: "File quá nhiều dòng (tối đa 5.000). Hãy tách nhỏ rồi nhập từng phần.",
  no_values: "Hãy nhập ít nhất một số liệu.",
  invalid_channel: "Tên kênh chỉ gồm chữ không dấu, số, dấu - và _.",
  batch_not_found: "Không tìm thấy lần nhập này.",
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

type ApiError = { error?: { code?: string; details?: { missing?: string[]; skus?: string[]; problems?: { line: number; problem: string }[]; total?: number } } };

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
