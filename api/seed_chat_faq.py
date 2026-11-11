"""Add verified usage FAQs and unapproved policy drafts without overwriting existing FAQs."""

# Long Vietnamese FAQ text is kept readable as single source strings.
# ruff: noqa: E501
from sqlalchemy import select

from app.core.config import get_settings
from app.core.db import make_engine, make_session_factory
from app.modules.chat.models import FAQ

FAQS = [
    (
        "Chatbot hỗ trợ những gì?",
        "Trợ lý hỗ trợ tra sản phẩm, giá, lượng hàng chưa giữ chỗ và thông tin mô tả bán hàng từ Odoo. Các chính sách cửa hàng chỉ được tư vấn khi đã có FAQ được duyệt.",
        True,
    ),
    (
        "Làm sao hỏi đúng sản phẩm?",
        "Hãy nhập tên sản phẩm hoặc SKU. Nếu website gửi SKU sản phẩm đang xem, bạn có thể hỏi 'món này'. Khi chưa rõ sản phẩm, trợ lý sẽ hỏi lại.",
        True,
    ),
    (
        "Giá sản phẩm lấy từ đâu?",
        "Giá được đọc từ Odoo tại thời điểm tra cứu. Giá này chưa phải xác nhận tổng tiền thanh toán hoặc phí vận chuyển.",
        True,
    ),
    (
        "On Hand và hàng còn có thể bán khác nhau thế nào?",
        "On Hand là tổng tồn thực tế; lượng chưa giữ chỗ là hàng còn tự do trong phạm vi kho tài khoản Odoo được xem. Số lượng có thể thay đổi và không đồng nghĩa đã giữ hàng cho khách.",
        True,
    ),
    (
        "Chatbot có đặt hoặc giữ hàng giúp tôi không?",
        "Chatbot hiện hỗ trợ tư vấn, chưa tạo đơn hoặc giữ hàng. Bạn cần thực hiện thao tác đặt mua trên website nếu có, hoặc liên hệ cửa hàng để được hỗ trợ.",
        True,
    ),
    (
        "Tôi cần biết thành phần, độ cay và cách bảo quản?",
        "Trợ lý chỉ trả lời từ mô tả sản phẩm công khai có ghi rõ thông tin đó. Nếu chưa có dữ liệu, cần liên hệ cửa hàng để xác minh; không suy ra thành phần hoặc độ cay từ tên hay ảnh.",
        True,
    ),
    (
        "Tôi bị dị ứng thì có dùng sản phẩm được không?",
        "Cần kiểm tra thành phần, chất gây dị ứng và nguy cơ nhiễm chéo với cửa hàng. Trợ lý không khẳng định sản phẩm an toàn cho người có dị ứng khi chưa đủ dữ liệu xác minh.",
        True,
    ),
    (
        "Làm sao yêu cầu nhân viên hỗ trợ?",
        "Bấm 'Cần nhân viên hỗ trợ' trong khung chat. Yêu cầu sẽ được ghi nhận; khi nhân viên tiếp nhận, AI tạm dừng trong hội thoại. Dùng kênh liên hệ cửa hàng hiển thị trong khung chat để trao đổi; đây chưa phải nhắn tin trực tiếp với nhân viên.",
        True,
    ),
    (
        "Cửa hàng giao đến đâu và phí vận chuyển bao nhiêu?",
        "BẢN NHÁP: Cần cửa hàng xác nhận khu vực giao, cách tính phí và thời gian dự kiến trước khi duyệt.",
        False,
    ),
    (
        "Chính sách đổi trả của cửa hàng là gì?",
        "BẢN NHÁP: Cần cửa hàng xác nhận điều kiện, thời hạn, chứng từ và cách liên hệ đổi trả trước khi duyệt.",
        False,
    ),
    (
        "Cửa hàng nhận hình thức thanh toán nào?",
        "BẢN NHÁP: Cần xác nhận COD, chuyển khoản hoặc phương thức thực tế đang hỗ trợ trước khi duyệt.",
        False,
    ),
]


def main():
    with make_session_factory(make_engine(get_settings().database_url))() as db:
        existing = set(db.scalars(select(FAQ.question)))
        added = 0
        for question, answer, approved in FAQS:
            if question not in existing:
                db.add(FAQ(question=question, answer=answer, approved=approved))
                added += 1
        db.commit()
        print(f"Added {added} FAQs; existing content preserved.")


if __name__ == "__main__":
    main()
