"""Find the passages closest to a question: cosine similarity over the stored embeddings, with two small nudges."""

from __future__ import annotations

import json
from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.text import fold

from .embedder import Embedder
from .models import KbChunk

SKU_BOOST = 0.25  # the product the customer is looking at is probably the one they mean
NAME_BOOST = 0.15  # a product named in the question is almost certainly the one they mean
KIND_BOOST = 0.2  # the question says what kind of fact it wants ("ingredients", "how to store")

# Words (accent-free) that show which kind of passage answers the question. Each product has one passage per kind, and the
# overview repeats the product name, so without this hint the overview often outranks the passage that really answers.
KIND_CUES = {
    "ingredients": ("thanh phan", "nguyen lieu", "lam tu", "gom nhung gi", "chua ", "co nhung gi", "di ung"),
    "storage": ("bao quan", "han dung", "de duoc bao lau", "het han", "han su dung", "de duoc may"),
}


def cue_kinds(folded_query: str) -> set[str]:
    return {kind for kind, cues in KIND_CUES.items() if any(c in folded_query for c in cues)}


@dataclass(frozen=True)
class Hit:
    source_type: str
    source_key: str
    kind: str
    sku: str | None
    title: str
    text: str
    score: float
    relevance: float = (
        0.0  # the score without the nudge for the product being viewed: does the text itself match?
    )


def _cosine(a: list[float], b: list[float]) -> float:
    return sum(x * y for x, y in zip(a, b, strict=False))  # both are unit length


def retrieve(db: Session, embedder: Embedder, query: str, k: int = 5, sku: str | None = None) -> list[Hit]:
    rows = list(db.scalars(select(KbChunk).where(KbChunk.embedder == embedder.name)))
    if not rows or not query.strip():
        return []
    q = embedder.embed([query])[0]
    folded = fold(query)
    wanted = cue_kinds(folded)
    scored = []
    for r in rows:
        relevance = _cosine(q, json.loads(r.embedding))
        if r.source_type == "product" and fold(r.title) in folded:
            relevance += NAME_BOOST
        if r.kind in wanted:
            relevance += KIND_BOOST
        score = relevance + (SKU_BOOST if sku and r.sku == sku else 0.0)
        scored.append((score, relevance, r))
    scored.sort(key=lambda t: t[0], reverse=True)
    return [
        Hit(r.source_type, r.source_key, r.kind, r.sku, r.title, r.text, round(s, 4), round(rel, 4))
        for s, rel, r in scored[:k]
    ]
