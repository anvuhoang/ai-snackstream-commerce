# Chatbot tích hợp trong dự án chính

- Backend: `api/app/modules/chat` (FAQ, cấu hình bot, hỗ trợ, log).
- Catalog Odoo đọc qua service, chỉ gồm các trường công khai được phép tư vấn.
- Giao diện: `web/src/components/chat-widget.tsx` và CSS module riêng.
- `ChatLauncher` gắn component trực tiếp trong layout cửa hàng; không dùng iframe.
- Quản trị dùng chung đăng nhập admin hiện có tại `/admin/chat` và `/admin/chat/manage`.
- API chạy cổng 8000, web cổng 3000; browser dùng proxy `/api/*` sẵn có.
- Key đặt trong `api/.env`, không dùng NEXT_PUBLIC_CHAT_URL hoặc CHAT_FRAME_ORIGINS.

Các dữ liệu thiếu từ bản chat riêng đã được nhập vào database chính theo mã câu hỏi,
SKU/câu FAQ và mã hội thoại; không ghi đè bản ghi sẵn có. Bản dự phòng trước hợp nhất
nằm ngoài repository tại `chatbot-merge-backup-20261111`.

Xem README ở gốc repository để chạy bằng hai terminal.

## Thành phần trong ghi chú Odoo

Ưu tiên Sales Description. Khi trường đó trống, backend đọc Internal Notes nhưng
chỉ trích các mục có nhãn Ingredients/Thành phần, Storage/Bảo quản và
Flavor and texture/Hương vị. Không đưa phần ghi chú thô vào Product hoặc prompt.
Nhãn khác được dùng làm ranh giới để loại giá vốn, nhà cung cấp và các mục nội bộ.
Nội dung không có nhãn được xem là chưa có dữ liệu; không đoán từ tên hoặc ảnh.
Thay đổi backend yêu cầu khởi động lại API nếu không chạy với --reload.
