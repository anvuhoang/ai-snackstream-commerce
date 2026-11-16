"""Measure retrieval: for each question with a known right answer, is the right passage among the top k?

hit@k  = share of questions whose right passage is in the first k results.
MRR    = mean of 1 / (rank of the first right passage); 1.0 means it is always first.
A question's `expect` lists the passages that would answer it, as {"sku": ..., "kind": ...}; `kind` may be left out.
"""

from __future__ import annotations

from sqlalchemy.orm import Session

from .embedder import Embedder
from .retriever import Hit, retrieve


def _right(hit: Hit, expect: list[dict]) -> bool:
    return any(hit.sku == e["sku"] and (e.get("kind") in (None, hit.kind)) for e in expect)


def evaluate(
    db: Session, embedder: Embedder, questions: list[dict], ks: tuple[int, ...] = (1, 3, 5, 8)
) -> dict:
    top = max(ks)
    ranks: list[int | None] = []
    misses: list[dict] = []
    for item in questions:
        hits = retrieve(db, embedder, item["q"], top)
        rank = next((i + 1 for i, h in enumerate(hits) if _right(h, item["expect"])), None)
        ranks.append(rank)
        if rank is None or rank > min(ks):
            misses.append({"q": item["q"], "rank": rank, "got": [f"{h.sku}:{h.kind}" for h in hits[:3]]})
    n = len(questions) or 1
    return {
        "questions": len(questions),
        "embedder": embedder.name,
        **{f"hit@{k}": round(sum(1 for r in ranks if r is not None and r <= k) / n, 3) for k in ks},
        "mrr": round(sum(1 / r for r in ranks if r) / n, 3),
        "misses": misses,
    }
