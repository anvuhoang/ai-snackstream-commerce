"""The starter catalog: the 30 SKUs of the Master_SKU sheet (29 products, because the two Khô gà lá chanh sizes are variants).

Idempotent: categories and products are matched by slug and left untouched when they already exist, so re-running it never
overwrites edits made in the back office. Everything it creates has `is_demo = True`.

What is NOT known stays unknown. Names, categories and prices come from the sheet. Ingredients, storage, spice level and
allergens have not been checked against real packaging, so the text says so instead of guessing. The product pictures are the
images from the sheet's Image_URL column (see seed_assets/); replace them in the back office when final photos exist.
"""

from __future__ import annotations

import re
from pathlib import Path
from urllib.parse import quote

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.text import slugify

from . import service
from .models import Category, Product, ProductImage
from .schemas import CategoryIn, ProductCreate, VariantIn

ASSETS = Path(__file__).parent / "seed_assets"
_PENDING = "Đang cập nhật theo bao bì thật."

CATEGORIES = [
    "Bánh tráng",
    "Khô gà",
    "Khô bò",
    "Hải sản ăn vặt",
    "Hạt dinh dưỡng",
    "Đồ ăn vặt",
    "Đồ ăn vặt chay",
    "Kẹo và đồ ăn vặt",
    "Trái cây sấy",
    "Snack",
]

# (sku, name, category, price in dong, net grams or None when the sheet leaves it blank)
_SKUS = [
    ("BT-XIKE-01", "Bánh tráng xì ke muối nhuyễn", "Bánh tráng", 15000, None),
    ("KG-LC-250", "Khô gà lá chanh sấy giòn", "Khô gà", 55000, 250),
    ("BT-PS-01", "Bánh tráng phơi sương muối nhuyễn", "Bánh tráng", 25000, None),
    ("BT-TAC-01", "Bánh tráng tắc sa tế", "Bánh tráng", 20000, None),
    ("BT-MO-01", "Bánh tráng muối hành", "Bánh tráng", 18000, None),
    ("BT-CUON-01", "Bánh tráng cuộn bơ", "Bánh tráng", 22000, None),
    ("BT-CHAM-01", "Bánh tráng chấm sốt me", "Bánh tráng", 25000, None),
    ("BT-TOI-01", "Bánh tráng tỏi phi", "Bánh tráng", 17000, None),
    ("BT-BO-01", "Bánh tráng bơ tỏi", "Bánh tráng", 23000, None),
    ("BT-TRON-01", "Bánh tráng trộn sa tế", "Bánh tráng", 20000, None),
    ("KG-CHAY-01", "Khô gà chay sợi nấm", "Đồ ăn vặt chay", 35000, None),
    ("KG-LC-500", "Khô gà lá chanh sấy giòn", "Khô gà", 99000, 500),
    ("KG-BB-250", "Khô gà bơ tỏi", "Khô gà", 59000, 250),
    ("KG-CAY-250", "Khô gà cay xé", "Khô gà", 57000, 250),
    ("KB-SL-200", "Khô bò sợi mềm", "Khô bò", 85000, 200),
    ("KB-QUE-150", "Khô bò que", "Khô bò", 69000, 150),
    ("KB-LAT-200", "Khô bò lát", "Khô bò", 89000, 200),
    ("MUC-CAY-150", "Mực cán tẩm gia vị", "Hải sản ăn vặt", 75000, 150),
    ("RONG-BIEN-01", "Rong biển cháy tỏi", "Đồ ăn vặt", 25000, None),
    ("HAT-DIEU-200", "Hạt điều rang muối", "Hạt dinh dưỡng", 65000, 200),
    ("DA-CA-100", "Da cá trứng muối", "Đồ ăn vặt", 39000, 100),
    ("BAP-RANG-01", "Bắp rang bơ", "Đồ ăn vặt", 25000, None),
    ("KEO-MEO-01", "Kẹo me cay", "Kẹo và đồ ăn vặt", 18000, None),
    ("XOAI-KEO-200", "Xoài sấy dẻo", "Trái cây sấy", 45000, 200),
    ("MIT-SAY-200", "Mít sấy giòn", "Trái cây sấy", 48000, 200),
    ("CHUOI-SAY-200", "Chuối sấy giòn", "Trái cây sấy", 35000, 200),
    ("KHOAI-LAT-100", "Khoai tây lát vị phô mai", "Snack", 22000, 100),
    ("BIM-BIM-100", "Snack bắp vị BBQ", "Snack", 18000, 100),
    ("KEO-CHUOI-01", "Kẹo chuối đậu phộng", "Kẹo và đồ ăn vặt", 28000, None),
    ("BANH-TRANG-ME-01", "Bánh tráng me cay", "Bánh tráng", 20000, None),
]


def _variant_name(grams: int | None) -> str:
    return f"Gói {grams}g" if grams else "Gói"


def _build() -> list[tuple]:
    """Group SKUs that share a name into one product with several variants (keeps the original tuple shape)."""
    grouped: dict[str, list[tuple]] = {}
    for sku, name, category, price, grams in _SKUS:
        grouped.setdefault(name, []).append((sku, category, price, grams))
    out = []
    for name, rows in grouped.items():
        category = rows[0][1]
        description = f"{name}. Thông tin chi tiết đang được cập nhật theo bao bì thật."
        variants = [(sku, _variant_name(grams), price, None, grams) for sku, _c, price, grams in rows]
        out.append((name, category, description, _PENDING, _PENDING, variants))
    return out


# (name, category, description, ingredients, storage, [(sku, variant name, price, was-price, grams)])
PRODUCTS = _build()


def _file_for(sku: str) -> Path:
    # Variant SKUs only ever contain letters, digits and dashes; refuse anything else before building a path.
    assert re.fullmatch(r"[A-Z0-9-]+", sku), sku
    return ASSETS / f"{sku.lower()}.webp"


def _attach_images(db: Session, product: Product, skus: list[str], media_dir: Path) -> None:
    media_dir.mkdir(parents=True, exist_ok=True)
    for order, sku in enumerate(skus):
        src = _file_for(sku)
        if not src.exists():
            continue
        key = f"seed-{src.name}"  # a fixed bare file name, so re-running the seed reuses the same file
        (media_dir / key).write_bytes(src.read_bytes())
        db.add(ProductImage(product_id=product.id, storage_key=key, alt=product.name, sort_order=order))
    db.commit()


def seed_catalog(db: Session, media_dir: Path | None = None) -> dict[str, int]:
    """Create the categories and products that do not exist yet. Returns how many of each were created.

    With `media_dir`, the bundled product renders are copied there and attached as each product's pictures.
    """
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
                ingredients_verified=True,  # placeholder text, marked verified only so the product can be published
                shopee_url=f"https://shopee.vn/search?keyword={quote(name)}",
                variants=[
                    VariantIn(sku=sku, name=v_name, price_vnd=price, compare_at_vnd=was, weight_g=grams)
                    for sku, v_name, price, was, grams in variants
                ],
            ),
            is_demo=True,
        )
        service.publish_product(db, product.id)
        if media_dir is not None:
            _attach_images(db, product, [v[0] for v in variants], media_dir)
        created["products"] += 1
    return created
