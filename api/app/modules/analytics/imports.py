"""Importing numbers that other channels report (TikTok, Facebook, Shopee ...), from a CSV file or typed in by hand.

Rules, written down because they are easy to get wrong:
- A cell that is empty means "not reported": nothing is stored for it. It is never turned into 0.
- A file with ANY bad row is refused as a whole (with the first problems listed), so nobody ends up with half a file.
- The same file can never be imported twice (SHA-256 of its bytes). The same value for the same key (day, channel, content,
  metric, demo flag) is never stored twice either: a repeat is skipped and counted, and never overwrites what is there.
- Every file or manual entry is one batch, so a wrong import can be undone by deleting its batch.
"""

from __future__ import annotations

import csv
import hashlib
import io
import json
import re
from datetime import date, datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.db import utcnow
from app.core.errors import AppError
from app.core.text import fold
from app.modules.auth.models import AdminUser

from .models import METRICS, ChannelMetric, ImportBatch

MAX_BYTES = 2 * 1024 * 1024
MAX_ROWS = 5000
MAX_PROBLEMS = 20

# What a column may be called in the file (accents and case are ignored). Vietnamese names are accepted too.
ALIASES: dict[str, str] = {
    "date": "date",
    "day": "date",
    "ngay": "date",
    "channel": "channel",
    "source": "channel",
    "kenh": "channel",
    "nguon": "channel",
    "content": "content",
    "content_code": "content",
    "utm_content": "content",
    "noi dung": "content",
    "ma noi dung": "content",
    "views": "views",
    "view": "views",
    "luot xem": "views",
    "impressions": "impressions",
    "impression": "impressions",
    "luot hien thi": "impressions",
    "clicks": "clicks",
    "click": "clicks",
    "luot click": "clicks",
    "orders": "orders",
    "order": "orders",
    "don": "orders",
    "so don": "orders",
    "don hang": "orders",
    "revenue": "revenue_vnd",
    "revenue_vnd": "revenue_vnd",
    "doanh thu": "revenue_vnd",
    "cost": "cost_vnd",
    "cost_vnd": "cost_vnd",
    "chi phi": "cost_vnd",
}
CHANNEL = re.compile(r"^[a-z0-9][a-z0-9_-]{0,39}$")
THOUSANDS = re.compile(r"^\d{1,3}([.,]\d{3})+$")


def _norm(name: str) -> str:
    return re.sub(r"\s+", " ", fold(name or "").replace("_", " ")).strip()


_ALIASES = {_norm(k): v for k, v in ALIASES.items()}


def _header(name: str) -> str | None:
    return _ALIASES.get(_norm(name))


def parse_day(raw: str) -> date | None:
    raw = (raw or "").strip()
    for fmt in ("%Y-%m-%d", "%d/%m/%Y", "%d-%m-%Y", "%d.%m.%Y"):
        try:
            return datetime.strptime(raw, fmt).date()
        except ValueError:
            continue
    return None


def parse_count(raw: str) -> int | None:
    """ "1.200.000", "1,200", "5000đ" or "300" -> an integer. Anything else (negative, decimals, words) -> None."""
    s = (raw or "").strip().lower().replace("đ", "").replace("vnd", "").replace(" ", "")
    if THOUSANDS.match(s):
        s = re.sub(r"[.,]", "", s)
    return int(s) if s.isdigit() else None


def _decode(data: bytes) -> str:
    for enc in ("utf-8-sig", "utf-16"):
        try:
            return data.decode(enc)
        except UnicodeError:
            continue
    raise AppError(422, "csv_unreadable", "The file is not text. Save it as CSV (UTF-8) and try again.")


def parse_csv(data: bytes) -> list[dict]:
    """Rows as {day, channel, content, values: {metric: int}} or raise AppError(422) listing the first problems."""
    if len(data) > MAX_BYTES:
        raise AppError(413, "file_too_large", f"The file may be at most {MAX_BYTES // (1024 * 1024)} MB.")
    text = _decode(data)
    sample = text[:4096]
    delimiter = (
        ";"
        if sample.count(";") > sample.count(",")
        else ("\t" if sample.count("\t") > sample.count(",") else ",")
    )
    reader = csv.reader(io.StringIO(text), delimiter=delimiter)
    try:
        head = next(reader)
    except StopIteration:
        raise AppError(422, "csv_empty", "The file is empty.") from None
    cols = [_header(h) for h in head]
    missing = [name for name in ("date", "channel") if name not in cols]
    if missing or not any(c in METRICS for c in cols):
        raise AppError(
            422,
            "csv_columns",
            "The first row must name the columns: date, channel, and at least one of "
            + ", ".join(m.removesuffix("_vnd") for m in METRICS)
            + ".",
            {"found": [h for h in head if h]},
        )
    rows: list[dict] = []
    problems: list[dict] = []
    for line_no, cells in enumerate(reader, start=2):
        if not any(c.strip() for c in cells):
            continue  # a blank line
        if len(rows) + len(problems) >= MAX_ROWS:
            raise AppError(
                413,
                "too_many_rows",
                f"A file may have at most {MAX_ROWS} rows. Split it and import the parts.",
            )
        by = {cols[i]: (cells[i] if i < len(cells) else "") for i in range(len(cols)) if cols[i]}
        day = parse_day(by.get("date", ""))
        channel = fold(by.get("channel", "")).strip().replace(" ", "-")
        values: dict[str, int] = {}
        errors: list[str] = []
        if day is None:
            errors.append("date is not a date (use 2026-11-02 or 02/11/2026)")
        if not CHANNEL.match(channel):
            errors.append("channel is empty or has odd characters (letters, digits, - and _ only)")
        for m in METRICS:
            cell = by.get(m, "")
            if not cell.strip():
                continue  # not reported
            n = parse_count(cell)
            if n is None:
                errors.append(f"{m.removesuffix('_vnd')} is not a whole number >= 0 ({cell.strip()[:20]!r})")
            else:
                values[m] = n
        if not errors and not values:
            errors.append("the row has no numbers")
        if errors:
            problems.append({"line": line_no, "problem": "; ".join(errors)})
            continue
        rows.append(
            {"day": day, "channel": channel, "content": by.get("content", "").strip()[:100], "values": values}
        )
    if problems:
        raise AppError(
            422,
            "csv_invalid_rows",
            f"{len(problems)} row(s) have a problem. Nothing was imported; fix the file and try again.",
            {"problems": problems[:MAX_PROBLEMS], "total": len(problems)},
        )
    if not rows:
        raise AppError(422, "csv_empty", "The file has a header but no data rows.")
    return rows


def _store(db: Session, batch: ImportBatch, rows: list[dict]) -> None:
    """Add every value that is not stored yet; count the ones that are."""
    existing = {
        (m.day, m.channel, m.content_code, m.metric)
        for m in db.scalars(
            select(ChannelMetric).where(
                ChannelMetric.is_demo == batch.is_demo,
                ChannelMetric.day.in_({r["day"] for r in rows}),
                ChannelMetric.channel.in_({r["channel"] for r in rows}),
            )
        )
    }
    imported = skipped = 0
    for r in rows:
        for metric, value in r["values"].items():
            key = (r["day"], r["channel"], r["content"], metric)
            if key in existing:
                skipped += 1
                continue
            existing.add(key)
            db.add(
                ChannelMetric(
                    batch_id=batch.id,
                    day=r["day"],
                    channel=r["channel"],
                    content_code=r["content"],
                    metric=metric,
                    value=value,
                    is_demo=batch.is_demo,
                )
            )
            imported += 1
    batch.values_imported, batch.values_skipped = imported, skipped


def _new_batch(
    db: Session, kind: str, filename: str, digest: str, is_demo: bool, rows: int, actor: AdminUser
) -> ImportBatch:
    if db.scalar(select(ImportBatch.id).where(ImportBatch.sha256 == digest)) is not None:
        what = "This file was already imported." if kind == "csv" else "This exact entry was already added."
        raise AppError(
            409, "import_duplicate", what + " Delete the earlier batch first if you want to add it again."
        )
    batch = ImportBatch(
        kind=kind,
        filename=filename[:200],
        sha256=digest,
        is_demo=is_demo,
        rows_total=rows,
        created_by=actor.id,
        created_at=utcnow(),
    )
    db.add(batch)
    db.flush()
    return batch


def import_csv(db: Session, filename: str, data: bytes, is_demo: bool, actor: AdminUser) -> ImportBatch:
    rows = parse_csv(data)
    batch = _new_batch(
        db,
        "csv",
        filename,
        hashlib.sha256(data + (b"|demo" if is_demo else b"")).hexdigest(),
        is_demo,
        len(rows),
        actor,
    )
    _store(db, batch, rows)
    db.commit()
    return batch


def add_manual(
    db: Session,
    day: date,
    channel: str,
    content: str,
    values: dict[str, int],
    is_demo: bool,
    actor: AdminUser,
) -> ImportBatch:
    channel = fold(channel).strip().replace(" ", "-")
    if not CHANNEL.match(channel):
        raise AppError(422, "invalid_channel", "The channel may only have letters, digits, - and _.")
    values = {k: v for k, v in values.items() if v is not None}
    if not values:
        raise AppError(422, "no_values", "Enter at least one number.")
    canon = json.dumps(
        {"d": day.isoformat(), "c": channel, "x": content.strip(), "v": values, "demo": is_demo},
        sort_keys=True,
    )
    batch = _new_batch(
        db, "manual", "manual entry", hashlib.sha256(canon.encode()).hexdigest(), is_demo, 1, actor
    )
    _store(db, batch, [{"day": day, "channel": channel, "content": content.strip()[:100], "values": values}])
    db.commit()
    return batch


def delete_batch(db: Session, batch_id: int) -> None:
    batch = db.get(ImportBatch, batch_id)
    if batch is None:
        raise AppError(404, "batch_not_found", "That import was not found.")
    for m in db.scalars(select(ChannelMetric).where(ChannelMetric.batch_id == batch_id)):
        db.delete(m)
    db.delete(batch)
    db.commit()


def list_batches(db: Session, limit: int = 50) -> list[tuple[ImportBatch, str | None]]:
    rows = db.execute(
        select(ImportBatch, AdminUser.email)
        .outerjoin(AdminUser, AdminUser.id == ImportBatch.created_by)
        .order_by(ImportBatch.id.desc())
        .limit(limit)
    ).all()
    return [(b, email) for b, email in rows]
