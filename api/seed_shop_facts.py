"""Put the shop's own facts in the database: the policy FAQs and, per product, when it suits ("Phù hợp khi ...").

Run once per database (also on Render):  python seed_shop_facts.py   then   python -m app.cli reindex-kb
Idempotent. A FAQ with the same question is left alone, so edits made in the admin are never overwritten; the usage sentence is
added to a product's description only when it is not already there.

Sources: the policy answers repeat what the shop's code does (payment methods, fee, hold time, order lookup); the usage
sentences come from Target_Pain_Point in Master_SKU_Database_Storefront.xlsx. There is NO return policy or delivery time here
because the shop has not decided them yet: add them in the admin FAQ page when it has.
"""

# ruff: noqa: E501
from sqlalchemy import select

from app.core.config import get_settings
from app.core.db import make_engine, make_session_factory
from app.modules.catalog.models import Product, Variant
from app.modules.chat.models import FAQ

FAQS = [
    (
        "Shop có những cách thanh toán nào?",
        "Có hai cách: thanh toán khi nhận hàng (COD), hoặc thanh toán online qua payOS bằng cách quét mã VietQR.",
    ),
    (
        "Phí giao hàng là bao nhiêu?",
        "Phí giao hàng đồng giá 30.000đ cho mỗi đơn. Đơn từ 300.000đ được miễn phí giao hàng.",
    ),
    (
        "Đơn thanh toán online được giữ hàng bao lâu?",
        "Đơn chọn thanh toán online được giữ hàng trong 15 phút. Quá thời gian này mà chưa thanh toán thì đơn tự hủy và hàng được trả lại kho; bạn có thể đặt lại.",
    ),
    (
        "Sản phẩm có phù hợp cho trẻ nhỏ không?",
        "Shop không đưa khuyến nghị theo độ tuổi. Với trẻ nhỏ, bạn nên xem kỹ nhãn về độ mặn, độ cay và thành phần, và lưu ý đồ ăn giòn cứng có thể gây hóc. Nếu cần hỏi thêm về một sản phẩm cụ thể, bạn bấm Cần hỗ trợ để nhân viên trả lời.",
    ),
    (
        "Tôi có bệnh lý hoặc đang ăn kiêng thì dùng được không?",
        "Shop không tư vấn theo tình trạng sức khỏe. Bạn nên đối chiếu thành phần và nhãn trên bao bì, và hỏi bác sĩ hoặc chuyên gia dinh dưỡng nếu cần. Shop chỉ cung cấp thông tin sản phẩm đúng như trên nhãn.",
    ),
    (
        "Tôi bị dị ứng thực phẩm thì chọn sản phẩm thế nào?",
        "Hãy đối chiếu thành phần và cảnh báo dị ứng trên bao bì sản phẩm trước khi dùng. Nếu trang sản phẩm chưa ghi thông tin dị ứng thì shop chưa có dữ liệu đó; bạn bấm Cần hỗ trợ để nhân viên xác nhận trước khi mua.",
    ),
    (
        "Làm sao tra cứu đơn hàng?",
        "Vào trang Tra cứu đơn hàng, nhập mã đơn (dạng SS-XXXX-XXXX) và số điện thoại đã dùng khi đặt. Không cần tạo tài khoản.",
    ),
]

# SKU -> when the product suits, from the sheet.
USE = {
    "BT-XIKE-01": "buồn miệng, ăn vặt giờ giải lao, xả stress",
    "KG-LC-250": "ăn vặt khi xem phim, ăn nhẹ giờ làm",
    "BT-PS-01": "ăn vặt buổi chiều, nhâm nhi cùng bạn bè",
    "BT-TAC-01": "thèm món chua cay, ăn vặt sau giờ học",
    "BT-MO-01": "ăn vặt giờ nghỉ, ăn cùng đồng nghiệp",
    "BT-CUON-01": "đổi vị khi xem phim, ăn vặt cuối tuần",
    "BT-CHAM-01": "thèm món chấm chua ngọt",
    "BT-TOI-01": "ăn vặt lúc làm việc, thích vị tỏi",
    "BT-BO-01": "thèm món béo thơm khi xem phim",
    "BT-TRON-01": "ăn vặt sau giờ học, tụ tập bạn bè",
    "KG-CHAY-01": "muốn món nhâm nhi không dùng thịt",
    "KG-LC-500": "mua dự trữ cho gia đình, xem phim",
    "KG-BB-250": "thèm vị béo mặn khi làm việc",
    "KG-CAY-250": "thích đồ cay để nhâm nhi",
    "KB-SL-200": "ăn vặt cuối tuần, đãi bạn bè",
    "KB-QUE-150": "nhâm nhi khi xem thể thao",
    "KB-LAT-200": "món nhắm ăn vặt cho buổi tụ họp",
    "MUC-CAY-150": "thích đồ biển đậm vị khi xem phim",
    "RONG-BIEN-01": "ăn nhẹ khi làm việc, cần món giòn",
    "HAT-DIEU-200": "ăn nhẹ giữa buổi, tiếp khách",
    "DA-CA-100": "thèm món giòn béo khi xem phim",
    "BAP-RANG-01": "xem phim tại nhà, ăn vặt cuối tuần",
    "KEO-MEO-01": "thèm đồ chua khi học hoặc làm việc",
    "XOAI-KEO-200": "muốn món ngọt chua thay bánh kẹo",
    "MIT-SAY-200": "ăn vặt tại văn phòng, thích trái cây",
    "CHUOI-SAY-200": "ăn nhẹ khi di chuyển hoặc làm việc",
    "KHOAI-LAT-100": "ăn vặt khi chơi game, xem phim",
    "BIM-BIM-100": "ăn nhanh giờ giải lao",
    "KEO-CHUOI-01": "tìm món ngọt dân dã để nhâm nhi",
    "BANH-TRANG-ME-01": "thích vị chua cay khi tan học",
}

# SKU -> other names customers use for the same product, so a question that uses them still finds it.
ALIASES = {
    "DA-CA-100": "da cá giòn",
    "BIM-BIM-100": "bim bim bắp",
    "KHOAI-LAT-100": "khoai tây chiên",
    "BAP-RANG-01": "bắp rang",
    "MUC-CAY-150": "mực khô",
}


def main() -> None:
    settings = get_settings()
    with make_session_factory(make_engine(settings.database_url))() as db:
        added = 0
        for question, answer in FAQS:
            if db.scalar(select(FAQ.id).where(FAQ.question == question)) is None:
                db.add(FAQ(question=question, answer=answer, approved=True))
                added += 1
        updated = 0
        for sku, pain in USE.items():
            product = db.scalar(
                select(Product).join(Variant, Variant.product_id == Product.id).where(Variant.sku == sku)
            )
            sentence = f"Phù hợp khi: {pain}."
            if product is not None and "Phù hợp khi:" not in product.description:  # one sentence per product
                product.description = f"{product.description.rstrip()} {sentence}"
                updated += 1
        for sku, alias in ALIASES.items():
            product = db.scalar(
                select(Product).join(Variant, Variant.product_id == Product.id).where(Variant.sku == sku)
            )
            sentence = f"Còn gọi là: {alias}."
            if product is not None and "Còn gọi là:" not in product.description:
                product.description = f"{product.description.rstrip()} {sentence}"
                updated += 1
        db.commit()
    print(f"FAQs added: {added}; product descriptions updated: {updated}")


if __name__ == "__main__":
    main()
