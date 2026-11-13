"""The dashboard API. Any signed-in back-office user may read it (it holds no personal data, only counts).

Adding numbers (CSV or by hand) needs a signed-in user plus the CSRF token; undoing an import is for admins only.
"""

from __future__ import annotations

import csv
import io
from datetime import date, timedelta
from typing import Annotated

from fastapi import APIRouter, Depends, File, Form, Query, Request, Response, UploadFile
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.core.errors import AppError
from app.modules.auth.deps import current_admin, require_csrf, require_role
from app.modules.auth.models import AdminUser

from . import channels, imports, report
from .models import METRICS, ChannelMetric
from .schemas import AiOut, BatchOut, ChannelsOut, DemoFilter, ManualIn, Overview, ShopeeOut

router = APIRouter(prefix="/api/admin/analytics", tags=["admin-analytics"])
Db = Annotated[Session, Depends(get_db)]
Reader = Depends(require_role("admin", "staff"))
Operator = [Depends(require_role("admin", "staff")), Depends(require_csrf)]
AdminWrite = [Depends(require_role("admin")), Depends(require_csrf)]
MAX_DAYS = 366

DateFrom = Annotated[date | None, Query(alias="from")]
DateTo = Annotated[date | None, Query(alias="to")]


def _range(date_from: date | None, date_to: date | None) -> tuple[date, date]:
    end = date_to or report.vn_today()
    start = date_from or end - timedelta(days=29)
    if start > end:
        raise AppError(422, "invalid_range", "`from` must not be after `to`.")
    if (end - start).days >= MAX_DAYS:
        raise AppError(422, "range_too_long", f"The period can be at most {MAX_DAYS} days.")
    return start, end


@router.get("/overview", response_model=Overview, dependencies=[Reader])
def overview(
    db: Db,
    date_from: DateFrom = None,
    date_to: DateTo = None,
    demo: DemoFilter = "exclude",
    source: Annotated[str | None, Query(max_length=100, description='A utm_source, or "direct".')] = None,
) -> Overview:
    """Funnel, totals, sources and products for Vietnam calendar days `from`..`to` (default: the last 30 days)."""
    start, end = _range(date_from, date_to)
    return report.overview(db, start, end, demo, (source or "").strip().lower() or None)


# ------------------------------------------------------------------ other channels, Shopee, AI
@router.get("/channels", response_model=ChannelsOut, dependencies=[Reader])
def channels_report(
    db: Db,
    date_from: DateFrom = None,
    date_to: DateTo = None,
    demo: DemoFilter = "exclude",
    channel: Annotated[str | None, Query(max_length=40)] = None,
) -> ChannelsOut:
    """What TikTok, Facebook and others report (imported or typed in), per channel."""
    start, end = _range(date_from, date_to)
    return channels.channels(db, start, end, demo, (channel or "").strip().lower() or None)


@router.get("/shopee", response_model=ShopeeOut, dependencies=[Reader])
def shopee_report(
    db: Db, date_from: DateFrom = None, date_to: DateTo = None, demo: DemoFilter = "exclude"
) -> ShopeeOut:
    start, end = _range(date_from, date_to)
    return channels.shopee(db, start, end, demo)


@router.get("/ai", response_model=AiOut, dependencies=[Reader])
def ai_report(
    db: Db, date_from: DateFrom = None, date_to: DateTo = None, demo: DemoFilter = "exclude"
) -> AiOut:
    start, end = _range(date_from, date_to)
    return channels.ai(db, start, end, demo)


# ------------------------------------------------------------------ data management
def _batch_out(batch, email: str | None) -> BatchOut:
    return BatchOut(
        id=batch.id,
        kind=batch.kind,
        filename=batch.filename,
        is_demo=batch.is_demo,
        rows_total=batch.rows_total,
        values_imported=batch.values_imported,
        values_skipped=batch.values_skipped,
        created_by_email=email,
        created_at=batch.created_at,
    )


@router.get("/imports", response_model=list[BatchOut], dependencies=[Reader])
def list_imports(db: Db) -> list[BatchOut]:
    return [_batch_out(b, email) for b, email in imports.list_batches(db)]


@router.post("/imports", response_model=BatchOut, status_code=201, dependencies=Operator)
def import_file(
    request: Request,
    db: Db,
    actor: AdminUser = Depends(current_admin),
    file: UploadFile = File(...),
    is_demo: bool = Form(False, alias="isDemo"),
) -> BatchOut:
    """Import a CSV of numbers reported by other channels. A bad row refuses the whole file; the same file is refused twice."""
    data = file.file.read(imports.MAX_BYTES + 1)
    batch = imports.import_csv(db, file.filename or "import.csv", data, is_demo, actor)
    return _batch_out(batch, actor.email)


@router.post("/manual", response_model=BatchOut, status_code=201, dependencies=Operator)
def add_manual(body: ManualIn, db: Db, actor: AdminUser = Depends(current_admin)) -> BatchOut:
    values = {m: getattr(body, m) for m in METRICS}
    batch = imports.add_manual(db, body.day, body.channel, body.content_code, values, body.is_demo, actor)
    return _batch_out(batch, actor.email)


@router.delete("/imports/{batch_id}", status_code=204, dependencies=AdminWrite)
def undo_import(batch_id: int, db: Db) -> Response:
    imports.delete_batch(db, batch_id)
    return Response(status_code=204)


# ------------------------------------------------------------------ export
def _csv(name: str, header: list[str], rows: list[list]) -> Response:
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(header)
    w.writerows(rows)
    # utf-8 with a BOM, so Excel shows Vietnamese text correctly
    return Response(
        content="﻿" + buf.getvalue(),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{name}"'},
    )


@router.get("/export/channels.csv", dependencies=[Reader])
def export_channels(
    db: Db, date_from: DateFrom = None, date_to: DateTo = None, demo: DemoFilter = "exclude"
) -> Response:
    """Every stored channel number in the period, one row per value, in the same format the importer reads back."""
    start, end = _range(date_from, date_to)
    stmt = channels._filter(select(ChannelMetric), start, end, demo, None).order_by(
        ChannelMetric.day, ChannelMetric.channel, ChannelMetric.id
    )
    rows = db.scalars(stmt).all()
    return _csv(
        f"channels_{start}_{end}.csv",
        ["date", "channel", "content", "metric", "value", "demo", "batch"],
        [
            [
                r.day.isoformat(),
                r.channel,
                r.content_code,
                r.metric,
                r.value,
                "yes" if r.is_demo else "no",
                r.batch_id,
            ]
            for r in rows
        ],
    )


@router.get("/export/overview.csv", dependencies=[Reader])
def export_overview(
    db: Db,
    date_from: DateFrom = None,
    date_to: DateTo = None,
    demo: DemoFilter = "exclude",
    source: Annotated[str | None, Query(max_length=100)] = None,
) -> Response:
    """The funnel and the by-source table, as the dashboard shows them (empty cells = cannot be computed)."""
    start, end = _range(date_from, date_to)
    data = report.overview(db, start, end, demo, (source or "").strip().lower() or None)
    rows: list[list] = [
        [
            "funnel",
            s.key,
            s.unit,
            s.count,
            "" if s.rate is None else round(s.rate, 4),
            s.rate_note,
            "gap" if s.tracking_gap else "",
        ]
        for s in data.funnel
    ]
    rows += [
        [
            "source",
            r.source or "direct",
            "",
            r.viewers,
            r.carters,
            r.orders_created,
            r.orders_completed,
            r.revenue_vnd,
        ]
        for r in data.by_source
    ]
    return _csv(
        f"overview_{start}_{end}.csv",
        [
            "section",
            "name",
            "unit_or_blank",
            "count_or_viewers",
            "rate_or_carters",
            "note_or_created",
            "gap_or_completed",
            "revenue_vnd",
        ],
        rows,
    )
