"""Turn text into vectors. Two embedders share one small interface so the rest of the code does not care which is used.

- HashingEmbedder: runs here, needs no key and no download. It matches words (with and without accents) and short letter
  groups, so it finds passages that share words with the question. It does not know that two different words mean the same.
- GeminiEmbedder: asks Gemini for embeddings, which do capture meaning. Needs GEMINI_API_KEY.
"""

from __future__ import annotations

import hashlib
import json
import math
import re
import urllib.error
import urllib.request
from typing import Protocol

from app.core.config import Settings
from app.core.errors import AppError
from app.core.text import fold

_WORD = re.compile(r"\w+", re.UNICODE)


class Embedder(Protocol):
    name: str

    def embed(self, texts: list[str]) -> list[list[float]]: ...


def _bucket(token: str, dim: int) -> tuple[int, float]:
    h = hashlib.blake2b(token.encode("utf-8"), digest_size=8).digest()
    n = int.from_bytes(h, "big")
    return n % dim, 1.0 if (n >> 63) & 1 else -1.0


def _features(text: str) -> list[tuple[str, float]]:
    """Words and word pairs with accents (weight 1) and without (weight 0.6), plus letter trigrams of each word (0.3)."""
    out: list[tuple[str, float]] = []
    for variant, weight in ((text.lower(), 1.0), (fold(text), 0.6)):
        words = _WORD.findall(variant)
        out += [(f"w:{w}", weight) for w in words]
        out += [(f"b:{a} {b}", weight) for a, b in zip(words, words[1:], strict=False)]
        if weight < 1.0:
            for w in words:
                padded = f"^{w}$"
                out += [(f"c:{padded[i : i + 3]}", 0.3) for i in range(max(1, len(padded) - 2))]
    return out


class HashingEmbedder:
    def __init__(self, dim: int = 512) -> None:
        self.dim = dim
        self.name = f"hash-{dim}"

    def embed(self, texts: list[str]) -> list[list[float]]:
        vectors = []
        for text in texts:
            v = [0.0] * self.dim
            for token, weight in _features(text):
                i, sign = _bucket(token, self.dim)
                v[i] += sign * weight
            norm = math.sqrt(sum(x * x for x in v)) or 1.0
            vectors.append([x / norm for x in v])
        return vectors


class GeminiEmbedder:
    """Calls Gemini's batch embedding endpoint. The model name comes from RAG_EMBED_MODEL."""

    def __init__(self, settings: Settings) -> None:
        self._key = settings.gemini_api_key
        self._model = settings.rag_embed_model
        self.name = f"gemini-{self._model}"

    def embed(self, texts: list[str]) -> list[list[float]]:
        if not self._key:
            raise AppError(503, "ai_not_configured", "A Gemini key is needed for Gemini embeddings")
        vectors: list[list[float]] = []
        for start in range(0, len(texts), 50):  # the API takes a limited batch
            batch = texts[start : start + 50]
            payload = {
                "requests": [
                    {"model": f"models/{self._model}", "content": {"parts": [{"text": t}]}} for t in batch
                ]
            }
            request = urllib.request.Request(
                f"https://generativelanguage.googleapis.com/v1beta/models/{self._model}:batchEmbedContents",
                data=json.dumps(payload).encode(),
                headers={"x-goog-api-key": self._key, "Content-Type": "application/json"},
                method="POST",
            )
            try:
                with urllib.request.urlopen(request, timeout=45) as response:
                    data = json.load(response)
                rows = data["embeddings"]
                if len(rows) != len(batch):
                    raise ValueError("wrong number of embeddings")
                for row in rows:
                    v = [float(x) for x in row["values"]]
                    norm = math.sqrt(sum(x * x for x in v)) or 1.0
                    vectors.append([x / norm for x in v])
            except urllib.error.HTTPError as exc:
                raise AppError(
                    429 if exc.code == 429 else 503, "ai_unavailable", "Embedding service failed"
                ) from exc
            except (OSError, ValueError, KeyError, TypeError) as exc:
                raise AppError(503, "ai_unavailable", "Embedding service failed") from exc
        return vectors


def make_embedder(settings: Settings) -> Embedder:
    return GeminiEmbedder(settings) if settings.rag_embedder == "gemini" else HashingEmbedder()
