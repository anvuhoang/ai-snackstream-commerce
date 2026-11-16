import { errorText } from "@/lib/errors";

const MESSAGES: Record<string, string> = {
  "live_audio_invalid": "Audio không đúng PCM16 mono 16000 Hz hoặc không dài 1–90 giây. Chưa thể bắt đầu host.",
  "live_content_unavailable": "Phiên này không dùng lời dẫn tạo từ sản phẩm.",
  "live_content_locked": "Chỉ chuẩn bị lời dẫn trước khi bắt đầu phiên.",
  "live_tts_not_configured": "Chưa cấu hình giọng và model ElevenLabs.",
  "live_content_timeout": "Tạo nội dung quá thời gian chờ.",
  "live_content_connection": "Không kết nối được dịch vụ tạo nội dung.",
  "live_script_too_long": "Hãy rút gọn thông tin sản phẩm và tạo phiên mới.",
  "live_script_invalid": "Kịch bản không hợp lệ; chưa tạo audio.",
  "live_audio_not_ready": "Hãy tạo và kiểm tra lời dẫn trước khi bắt đầu.",
  "host_audio_sku_mismatch": "SKU lời dẫn không khớp phiên.",
  "live_content_provider_error": "Dịch vụ tạo nội dung báo lỗi; không tự thử lại.",
  "live_content_format_invalid": "Dịch vụ trả định dạng không phù hợp.",
  "live_content_too_large": "Nội dung quá dài; hãy rút gọn thông tin sản phẩm.",
  "live_content_disabled": "Chưa bật chức năng tạo lời dẫn.",
  "live_content_busy": "Đang chuẩn bị nội dung; hãy chờ kết quả.",
  "live_script_review_required": "Hãy xem và xác nhận đúng kịch bản hiện tại.",
  "live_content_stale": "Phiên đã thay đổi; bỏ kết quả cũ."
};

export function liveContentError(body: unknown): string {
  const code = (body as { error?: { code?: string } } | undefined)?.error?.code;
  return (code && MESSAGES[code]) || errorText(body);
}
