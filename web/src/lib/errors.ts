/**
 * The API returns stable error codes ({"error": {"code": "...", "message": "..."}}); the message is English
 * and meant for logs. What the visitor reads comes from this table. Add a line when an endpoint adds a code.
 */
const MESSAGES: Record<string, string> = {
  not_authenticated: "Vui lòng đăng nhập.",
  invalid_credentials: "Sai e-mail hoặc mật khẩu.",
  too_many_attempts: "Bạn thử sai quá nhiều lần. Vui lòng chờ vài phút rồi thử lại.",
  csrf_invalid: "Phiên làm việc đã hết hạn. Hãy tải lại trang và thử lại.",
  forbidden: "Bạn không có quyền thực hiện thao tác này.",
  live_session_exists: "Đã có phiên chưa kết thúc. Hãy tải lại trang để xem phiên đó.",
  live_not_found: "Không tìm thấy phiên. Hãy tải lại trang.",
  live_invalid_state: "Trạng thái phiên đã thay đổi. Hãy tải lại trang và thử lại.",
  live_invalid_sku: "SKU không nằm trong danh sách của phiên.",
  live_not_running: "Phiên hiện không nhận câu hỏi.",
  live_question_conflict: "Mã câu hỏi đã được dùng cho nội dung khác.",
  live_question_capacity: "Phiên thử nghiệm đã đạt giới hạn số câu hỏi.",
  live_queue_full: "Hàng đợi đang đầy. Vui lòng gửi lại sau.",
  live_question_not_found: "Không tìm thấy câu hỏi trong phiên này.",
};

export const GENERIC_ERROR = "Có lỗi xảy ra. Vui lòng thử lại.";

/** Turn an API error body (or anything thrown) into text for the visitor. */
export function errorText(body: unknown): string {
  const code = (body as { error?: { code?: string } } | undefined)?.error?.code;
  return (code && MESSAGES[code]) || GENERIC_ERROR;
}
