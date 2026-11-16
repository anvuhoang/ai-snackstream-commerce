"""Cut the shop's own text into passages. Prices and stock are NOT passages: they change all the time and are read live."""

from __future__ import annotations

import hashlib
from dataclasses import dataclass
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.modules.catalog.models import Product
from app.modules.chat.models import FAQ

KNOWLEDGE_DIR = Path(__file__).parent / "knowledge"


@dataclass(frozen=True)
class ChunkSpec:
    source_type: str
    source_key: str
    kind: str
    sku: str | None
    title: str
    text: str

    @property
    def key(self) -> tuple[str, str, str]:
        return (self.source_type, self.source_key, self.kind)


def text_hash(text: str, embedder_name: str) -> str:
    return hashlib.sha256(f"{embedder_name}\n{text}".encode()).hexdigest()


def product_chunks(p: Product) -> list[ChunkSpec]:
    variants = [v for v in p.variants if v.is_active]
    if not variants:
        return []
    sku = variants[0].sku
    sizes = "; ".join(f"{v.name} ({v.weight_g} g)" if v.weight_g else v.name for v in variants)
    where = f" ({p.category.name})" if p.category else ""
    overview = f"{p.name}{where}. {p.description.strip()} Quy cách: {sizes}.".strip()
    out = [ChunkSpec("product", p.slug, "overview", sku, p.name, overview)]
    if p.ingredients.strip():
        out.append(
            ChunkSpec(
                "product",
                p.slug,
                "ingredients",
                sku,
                p.name,
                f"Thành phần của {p.name}: {p.ingredients.strip()}",
            )
        )
    if p.storage.strip():
        out.append(
            ChunkSpec(
                "product",
                p.slug,
                "storage",
                sku,
                p.name,
                f"Hạn dùng và bảo quản {p.name}: {p.storage.strip()}",
            )
        )
    return out


def faq_chunks(faq: FAQ) -> list[ChunkSpec]:
    return [
        ChunkSpec(
            "faq", f"faq:{faq.id}", "faq", None, faq.question[:200], f"Hỏi: {faq.question} Đáp: {faq.answer}"
        )
    ]


def doc_chunks(directory: Path = KNOWLEDGE_DIR) -> list[ChunkSpec]:
    out: list[ChunkSpec] = []
    for path in sorted(directory.glob("*.md")):
        for i, paragraph in enumerate(p.strip() for p in path.read_text(encoding="utf-8").split("\n\n")):
            if paragraph:
                out.append(ChunkSpec("doc", f"{path.name}#{i}", "doc", None, path.stem, paragraph))
    return out


def build_chunks(db: Session, directory: Path = KNOWLEDGE_DIR) -> list[ChunkSpec]:
    """Everything the chatbot may quote right now: published products, approved FAQs and the shop's policy files."""
    products = db.scalars(
        select(Product)
        .where(Product.status == "published")
        .options(selectinload(Product.variants), selectinload(Product.category))
        .order_by(Product.id)
    ).all()
    out = [c for p in products for c in product_chunks(p)]
    for faq in db.scalars(select(FAQ).where(FAQ.approved.is_(True)).order_by(FAQ.id)):
        out += faq_chunks(faq)
    return out + doc_chunks(directory)
