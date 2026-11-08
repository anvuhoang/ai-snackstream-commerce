"""The dashboard API. Any signed-in back-office user may read it (it holds no personal data, only counts)."""

from __future__ import annotations

from datetime import date, timedelta
from typing import Annotated

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.core.errors import AppError
from app.modules.auth.deps import require_role

from . import report
from .schemas import DemoFilter, Overview

router = APIRouter(prefix="/api/admin/analytics", tags=["admin-analytics"])
Db = Annotated[Session, Depends(get_db)]
MAX_DAYS = 366


@router.get("/overview", response_model=Overview, dependencies=[Depends(require_role("admin", "staff"))])
def overview(
    db: Db,
    date_from: Annotated[date | None, Query(alias="from")] = None,
    date_to: Annotated[date | None, Query(alias="to")] = None,
    demo: DemoFilter = "exclude",
    source: Annotated[str | None, Query(max_length=100, description='A utm_source, or "direct".')] = None,
) -> Overview:
    """Funnel, totals, sources and products for Vietnam calendar days `from`..`to` (default: the last 30 days)."""
    today = report.vn_today()
    end = date_to or today
    start = date_from or end - timedelta(days=29)
    if start > end:
        raise AppError(422, "invalid_range", "`from` must not be after `to`.")
    if (end - start).days >= MAX_DAYS:
        raise AppError(422, "range_too_long", f"The period can be at most {MAX_DAYS} days.")
    return report.overview(db, start, end, demo, (source or "").strip().lower() or None)
