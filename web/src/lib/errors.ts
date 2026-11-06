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
};

export const GENERIC_ERROR = "Có lỗi xảy ra. Vui lòng thử lại.";

/** Turn an API error body (or anything thrown) into text for the visitor. */
export function errorText(body: unknown): string {
  const code = (body as { error?: { code?: string } } | undefined)?.error?.code;
  return (code && MESSAGES[code]) || GENERIC_ERROR;
}
