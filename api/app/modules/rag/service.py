"""What the chatbot gets when retrieval is on: the best passages plus live price and stock for the products they are about."""

from __future__ import annotations

from dataclasses import dataclass, field

from sqlalchemy.orm import Session

from app.core.config import Settings
from app.modules.chat.schemas import ChatRequest
from app.modules.chat.schemas import Product as ChatProduct

from .embedder import make_embedder
from .live_facts import facts_for
from .retriever import Hit, retrieve


@dataclass
class RagContext:
    passages: list[str] = field(default_factory=list)
    products: list[ChatProduct] = field(default_factory=list)
    hits: list[Hit] = field(default_factory=list)
    min_score: float = 0.0

    @property
    def relevant(self) -> bool:
        """False when nothing the shop wrote down is close to the question: then there is nothing to send to Gemini."""
        return any(h.relevance >= self.min_score for h in self.hits)


def build_context(db: Session, settings: Settings, body: ChatRequest) -> RagContext:
    embedder = make_embedder(settings)
    # The last few turns matter for follow-ups ("and how do I store it?"), so they are searched together with the question.
    recent = " ".join(m.content for m in body.history[-2:] if m.role == "user")
    hits = retrieve(db, embedder, f"{recent} {body.message}".strip(), settings.rag_top_k, body.sku)
    skus = list(dict.fromkeys([h.sku for h in hits if h.sku] + ([body.sku] if body.sku else [])))
    return RagContext(
        passages=[f"[{h.title}] {h.text}" for h in hits],
        products=facts_for(db, settings, skus),
        hits=hits,
        min_score=settings.rag_min_score,
    )
