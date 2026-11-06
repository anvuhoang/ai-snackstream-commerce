from __future__ import annotations

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.db import get_db

router = APIRouter(prefix="/api", tags=["health"])


@router.get("/healthz")
def healthz() -> dict[str, bool]:
    """Liveness: the process is up. Does not touch the database."""
    return {"ok": True}


@router.get("/readyz")
def readyz(db: Session = Depends(get_db)):
    """Readiness: the process can reach its database."""
    try:
        db.execute(text("SELECT 1"))
    except Exception:  # noqa: BLE001 - any failure means "not ready"
        return JSONResponse({"ok": False, "database": "unreachable"}, status_code=503)
    return {"ok": True, "database": "up"}
