# Nút chat trên web chính

Web chính chỉ thêm `ChatLauncher` trong layout cửa hàng, kèm CSS module riêng.
Trang chủ, admin, catalog và backend cũ không bị thay thế.

Nút góc phải mở `/embed` của dự án chat riêng trong iframe. Giao diện nhúng chỉ
có phần chat, không có điều hướng/admin. Đóng rồi mở lại vẫn giữ hội thoại trong
phiên trang hiện tại. Màu nút dùng các token của web chính.

## Chạy trên máy

1. `snackstream-chat/api`: `.venv312\Scripts\python.exe -m uvicorn app.main:app --port 8001`
2. `snackstream-chat/web`: `npm.cmd run dev` (cổng 3001).
3. `ai-snackstream-commerce/web`: `npm.cmd run dev -- --webpack` (cổng 3000).

## Cấu hình khi triển khai

Web chính: đặt `NEXT_PUBLIC_CHAT_URL` thành URL web chat riêng và build lại.
Web chat riêng: đặt `CHAT_FRAME_ORIGINS` là các origin web chính được phép nhúng,
cách nhau bằng dấu cách; khởi động/build lại. Mặc định chỉ cho phép localhost:3000
và 127.0.0.1:3000. `/embed` dùng CSP frame-ancestors; admin và các trang còn lại
vẫn chặn iframe bằng X-Frame-Options DENY. Hai web nên cùng miền/site khi triển
khai để cookie hội thoại không bị trình duyệt chặn như cookie bên thứ ba.

API key vẫn chỉ nằm ở backend chat. Web chính không giữ key Odoo/Gemini.
