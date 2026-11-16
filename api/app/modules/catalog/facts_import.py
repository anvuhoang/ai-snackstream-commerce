"""Fill allergens, spice level, nutrition and the Shopee link from the sheet a person completed from the real packages.

Only non-empty cells are applied, so a blank never erases what is already stored (and "empty" keeps meaning "not known").
Rows are matched on SKU. Nutrition columns are per 100 g.
"""

from __future__ import annotations

import csv
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.errors import AppError

from . import service
from .models import Product, Variant
from .schemas import ProductUpdate

_NUTRITION = (
    ("energy_kcal_per_100g", "năng lượng {} kcal"),
    ("sugar_g_per_100g", "đường {} g"),
    ("fat_g_per_100g", "chất béo {} g"),
    ("sodium_mg_per_100g", "natri {} mg"),
)


def _cell(row: dict[str, str], key: str) -> str:
    return (row.get(key) or "").strip()


def nutrition_text(row: dict[str, str]) -> str:
    parts = [fmt.format(_cell(row, key)) for key, fmt in _NUTRITION if _cell(row, key)]
    if not parts:
        return ""
    return f"Trên 100 g: {'; '.join(parts)}."


def changes_for(row: dict[str, str]) -> dict[str, str]:
    mapping = {
        "allergens": _cell(row, "allergens_from_label"),
        "spice_level": _cell(row, "spice_level_checked"),
        "nutrition": nutrition_text(row),
        "shopee_url": _cell(row, "shopee_product_url"),
    }
    return {k: v for k, v in mapping.items() if v}


def import_facts(db: Session, rows: list[dict[str, str]]) -> dict[str, object]:
    updated, unknown, rejected = 0, [], []
    for row in rows:
        sku, changes = _cell(row, "sku"), changes_for(row)
        if not sku or not changes:
            continue
        product = db.scalar(
            select(Product).join(Variant, Variant.product_id == Product.id).where(Variant.sku == sku)
        )
        if product is None:
            unknown.append(sku)
            continue
        try:
            service.update_product(db, product.id, ProductUpdate(**changes))
        except (AppError, ValueError) as exc:
            rejected.append(f"{sku}: {exc}")
            continue
        updated += 1
    return {"updated": updated, "unknown_skus": unknown, "rejected": rejected}


def read_rows(path: Path) -> list[dict[str, str]]:
    with path.open(encoding="utf-8-sig", newline="") as f:
        return list(csv.DictReader(f))
