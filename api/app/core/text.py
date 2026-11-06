"""Vietnamese-aware text helpers used for search and URL slugs."""

from __future__ import annotations

import re
import unicodedata

_NON_ALNUM = re.compile(r"[^a-z0-9]+")


def fold(text: str) -> str:
    """Lowercase and strip diacritics, including "đ" -> "d", so "Bánh tráng" matches "banh trang"."""
    text = text.replace("đ", "d").replace("Đ", "D")
    decomposed = unicodedata.normalize("NFKD", text)
    return "".join(ch for ch in decomposed if not unicodedata.combining(ch)).lower()


def slugify(text: str, max_len: int = 80) -> str:
    """URL-safe slug: "Bánh tráng trộn Tây Ninh" -> "banh-trang-tron-tay-ninh"."""
    slug = _NON_ALNUM.sub("-", fold(text)).strip("-")[:max_len].strip("-")
    return slug or "item"
