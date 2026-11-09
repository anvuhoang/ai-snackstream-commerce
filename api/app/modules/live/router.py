import asyncio

from fastapi import APIRouter, Depends, Request
from fastapi.responses import StreamingResponse

from app.modules.auth.deps import require_csrf, require_role

from .schemas import (
    LiveCurrentOut,
    LivePinIn,
    LiveQuestionIn,
    LiveQuestionOut,
    LiveSessionCreate,
    LiveSessionOut,
)
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

@router.get("/events", response_class=StreamingResponse)
async def live_events(request: Request):
    live: LiveService = request.app.state.live

    async def generate():
        previous = None

        while not await request.is_disconnected():
            current = live.get_current()
            state_key = current.model_dump_json(by_alias=True) if current is not None else "null"

            if state_key != previous:
                payload = LiveCurrentOut(session=current).model_dump_json(by_alias=True)
                yield f"event: state\ndata: {payload}\n\n"
                previous = state_key
            else:
                yield ": keep-alive\n\n"

            await asyncio.sleep(1)

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache, no-transform",
            "X-Accel-Buffering": "no",
        },
    )

@admin_router.post(
    "/{live_id}/pin",
    response_model=LiveSessionOut,
    dependencies=[Depends(require_csrf)],
)
def pin_live(live_id: str, body: LivePinIn, request: Request) -> LiveSessionOut:
    live: LiveService = request.app.state.live
    return live.pin_sku(live_id, body.sku)

@router.post("/{live_id}/questions", response_model=LiveQuestionOut)
def submit_live_question(live_id: str, body: LiveQuestionIn, request: Request) -> LiveQuestionOut:
    live: LiveService = request.app.state.live
    return live.submit_question(live_id, body)

@admin_router.post(
    "/{live_id}/questions/{question_id}/skip",
    response_model=LiveQuestionOut,
    dependencies=[Depends(require_csrf)],
)
def skip_live_question(
    live_id: str,
    question_id: str,
    request: Request,
) -> LiveQuestionOut:
    live: LiveService = request.app.state.live
    return live.skip_question(live_id, question_id)

@admin_router.post(
    "/{live_id}/pause",
    response_model=LiveSessionOut,
    dependencies=[Depends(require_csrf)],
)
def pause_live(live_id: str, request: Request) -> LiveSessionOut:
    live: LiveService = request.app.state.live
    return live.pause_session(live_id)


@admin_router.post(
    "/{live_id}/resume",
    response_model=LiveSessionOut,
    dependencies=[Depends(require_csrf)],
)
def resume_live(live_id: str, request: Request) -> LiveSessionOut:
    live: LiveService = request.app.state.live
    return live.resume_session(live_id)