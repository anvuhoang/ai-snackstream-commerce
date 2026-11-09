from fastapi import APIRouter, Depends, Request

from app.modules.auth.deps import require_csrf, require_role

from .schemas import LiveCurrentOut, LiveSessionCreate, LiveSessionOut
from .service import LiveService

router = APIRouter(prefix="/api/live", tags=["live"])

admin_router = APIRouter(
    prefix="/api/admin/live",
    tags=["admin-live"],
    dependencies=[Depends(require_role("admin"))],
)


@router.get("/current", response_model=LiveCurrentOut)
def get_current_live(request: Request) -> LiveCurrentOut:
    live: LiveService = request.app.state.live
    return LiveCurrentOut(session=live.get_current())


@admin_router.post(
    "",
    response_model=LiveSessionOut,
    status_code=201,
    dependencies=[Depends(require_csrf)],
)
def create_live(body: LiveSessionCreate, request: Request) -> LiveSessionOut:
    live: LiveService = request.app.state.live
    return live.create_session(body)


@admin_router.post(
    "/{live_id}/start",
    response_model=LiveSessionOut,
    dependencies=[Depends(require_csrf)],
)
def start_live(live_id: str, request: Request) -> LiveSessionOut:
    live: LiveService = request.app.state.live
    return live.start_session(live_id)


@admin_router.post(
    "/{live_id}/end",
    response_model=LiveSessionOut,
    dependencies=[Depends(require_csrf)],
)
def end_live(live_id: str, request: Request) -> LiveSessionOut:
    live: LiveService = request.app.state.live
    return live.end_session(live_id)
