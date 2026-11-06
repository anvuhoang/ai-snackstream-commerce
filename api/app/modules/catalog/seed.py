"""A small labelled-demo catalog, so the shop has something to show from the first run.

Idempotent: categories and products are matched by slug and left untouched when they already exist, so re-running it never
overwrites edits made in the back office. Everything it creates has `is_demo = True`; replace it with real products before
selling anything. The ingredient and storage text below is illustrative, not taken from real packaging.
"""

from __future__ import annotations

from urllib.parse import quote

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.text import slugify

from . import service
from .models import Category, Product
from .schemas import CategoryIn, ProductCreate, VariantIn

_DRY = (
    "Bảo quản nơi khô ráo, thoáng mát, tránh ánh nắng trực tiếp. Sau khi mở nên đậy kín và dùng trong 7 ngày."
)
_MEAT = "Bảo quản ngăn mát tủ lạnh sau khi mở, đậy kín và dùng trong 30 ngày."
_FRUIT = "Bảo quản nơi khô ráo, thoáng mát. Sau khi mở nên buộc kín miệng túi, dùng trong 14 ngày."

CATEGORIES = ["Bánh tráng", "Khô & mực", "Trái cây sấy"]

# (name, category, description, ingredients, storage, [(sku, variant name, price, was-price, grams)])
PRODUCTS = [
    (
        "Bánh tráng trộn Tây Ninh",
        "Bánh tráng",
        "Bánh tráng cắt sợi trộn sẵn hành phi, muối tôm, sa tế và rau răm. Mở gói là ăn được ngay.",
        "Bánh tráng, muối tôm, sa tế (ớt, tỏi, dầu ăn), hành phi, rau răm sấy, đường.",
        _DRY,
        [("BTT-250", "Gói 250g", 39000, 49000, 250), ("BTT-500", "Gói 500g", 69000, 89000, 500)],
    ),
    (
        "Bánh tráng muối tôm Tây Ninh",
        "Bánh tráng",
        "Bánh tráng dẻo phết muối tôm cay nhẹ, ăn kèm hoặc cuốn tùy thích.",
        "Bánh tráng, muối tôm, ớt, đường, tỏi.",
        _DRY,
        [("BTM-200", "Gói 200g", 29000, None, 200), ("BTM-400", "Gói 400g", 52000, 58000, 400)],
    ),
    (
        "Bò khô sợi cay",
        "Khô & mực",
        "Bò khô xé sợi tẩm ướp cay đậm, dai và thơm mùi sả.",
        "Thịt bò, đường, muối, ớt, tỏi, sả, dầu mè, gia vị.",
        _MEAT,
        [("BK-200", "Hộp 200g", 129000, 149000, 200)],
    ),
    (
        "Khô gà lá chanh",
        "Khô & mực",
        "Khô gà xé sợi sấy với lá chanh và ớt, vị cay thơm đặc trưng.",
        "Thịt gà, lá chanh, ớt, tỏi, đường, muối, gia vị.",
        _MEAT,
        [("KG-250", "Hộp 250g", 89000, None, 250)],
    ),
    (
        "Mực rim me",
        "Khô & mực",
        "Mực tẩm rim với me chua ngọt, cay nhẹ, dùng làm quà vặt hoặc nhậu.",
        "Mực, me, đường, ớt, tỏi, nước mắm, gia vị.",
        _MEAT,
        [("MR-150", "Hộp 150g", 119000, 135000, 150)],
    ),
    (
        "Khô heo cháy tỏi",
        "Khô & mực",
        "Thịt heo sấy giòn rắc tỏi phi vàng, ăn vặt hay trộn cơm đều ngon.",
        "Thịt heo, tỏi, đường, muối, tiêu, gia vị.",
        _MEAT,
        [("KH-200", "Hộp 200g", 99000, None, 200)],
    ),
    (
        "Xoài sấy dẻo",
        "Trái cây sấy",
        "Xoài chín sấy dẻo, ngọt tự nhiên, ít chua.",
        "Xoài, đường.",
        _FRUIT,
        [("XS-200", "Gói 200g", 59000, None, 200)],
    ),
    (
        "Mít sấy giòn",
        "Trái cây sấy",
        "Mít sấy chân không giòn tan, giữ trọn vị ngọt thơm.",
        "Mít, dầu thực vật, đường.",
        _FRUIT,
        [("MS-150", "Gói 150g", 55000, 62000, 150)],
    ),
    (
        "Chuối sấy giòn",
        "Trái cây sấy",
        "Chuối chín thái lát sấy giòn, thơm ngọt, không cần chiên nhiều dầu.",
        "Chuối, dầu thực vật, đường.",
        _FRUIT,
        [("CS-200", "Gói 200g", 45000, None, 200)],
    ),
]


def seed_catalog(db: Session) -> dict[str, int]:
    """Create the demo categories and products that do not exist yet. Returns how many of each were created."""
    created = {"categories": 0, "products": 0}
    by_name: dict[str, Category] = {}
    for name in CATEGORIES:
        existing = db.scalar(select(Category).where(Category.slug == slugify(name)))
        if existing is None:
            existing = service.create_category(db, CategoryIn(name=name, sort_order=len(by_name)))
            created["categories"] += 1
        by_name[name] = existing

    for name, category, description, ingredients, storage, variants in PRODUCTS:
        if db.scalar(select(Product.id).where(Product.slug == slugify(name))):
            continue
        product = service.create_product(
            db,
            ProductCreate(
                name=name,
                category_id=by_name[category].id,
                description=description,
                ingredients=ingredients,
                storage=storage,
                ingredients_verified=True,  # demo data: marked verified so it can be published
                shopee_url=f"https://shopee.vn/search?keyword={quote(name)}",
                variants=[
                    VariantIn(sku=sku, name=v_name, price_vnd=price, compare_at_vnd=was, weight_g=grams)
                    for sku, v_name, price, was, grams in variants
                ],
            ),
            is_demo=True,
        )
        service.publish_product(db, product.id)
        created["products"] += 1
    return created
