"""Public event intake. Anyone may send behaviour events, so it is schema-validated and rate limited per address."""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, Request, Response
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.core.errors import AppError
from app.core.security import RateLimiter

from . import events
from .schemas import EventIn

router = APIRouter(prefix="/api", tags=["events"])
Db = Annotated[Session, Depends(get_db)]

_limiter = RateLimiter(limit=120, window_seconds=60)


def _client_ip(request: Request) -> str:
    forwarded = request.headers.get("x-forwarded-for", "")
    return forwarded.split(",")[0].strip() or (request.client.host if request.client else "")


@router.post("/events", status_code=204, response_class=Response)
def send_event(body: EventIn, request: Request, db: Db) -> Response:
    """Record one behaviour event. Order events are not accepted here: the server writes them when an order changes."""
    ip = _client_ip(request)
    if _limiter.blocked(ip):
        raise AppError(429, "too_many_events", "Too many events. Slow down.")
    _limiter.hit(ip)
    events.record_public(db, body)  # a repeat of the same eventId is accepted and ignored
    return Response(status_code=204)
