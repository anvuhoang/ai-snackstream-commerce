"""Keep the stored passages in step with the shop's text. Only passages whose text (or embedder) changed are embedded again."""

from __future__ import annotations

import json
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.orm import Session

from .chunker import KNOWLEDGE_DIR, build_chunks, text_hash
from .embedder import Embedder
from .models import KbChunk


def reindex(db: Session, embedder: Embedder, directory: Path = KNOWLEDGE_DIR) -> dict[str, int]:
    wanted = {c.key: c for c in build_chunks(db, directory)}
    existing = {(r.source_type, r.source_key, r.kind): r for r in db.scalars(select(KbChunk))}
    stats = {"added": 0, "updated": 0, "removed": 0, "unchanged": 0}

    todo = []
    for key, spec in wanted.items():
        row = existing.get(key)
        digest = text_hash(spec.text, embedder.name)
        if row is not None and row.content_hash == digest:
            stats["unchanged"] += 1
        else:
            todo.append((spec, row, digest))
    vectors = embedder.embed([spec.text for spec, _, _ in todo]) if todo else []
    for (spec, row, digest), vector in zip(todo, vectors, strict=True):
        if row is None:
            row = KbChunk(source_type=spec.source_type, source_key=spec.source_key, kind=spec.kind)
            db.add(row)
            stats["added"] += 1
        else:
            stats["updated"] += 1
        row.sku, row.title, row.text = spec.sku, spec.title, spec.text
        row.content_hash, row.embedder, row.dim = digest, embedder.name, len(vector)
        row.embedding = json.dumps([round(x, 6) for x in vector])
    for key, row in existing.items():
        if key not in wanted:
            db.delete(row)
            stats["removed"] += 1
    db.commit()
    return stats
