import asyncio

from fastapi import APIRouter, BackgroundTasks, Depends, Request
from fastapi.responses import StreamingResponse
from starlette.concurrency import run_in_threadpool

from app.core.errors import AppError
from app.modules.auth.deps import require_csrf, require_role

from .deps import require_make_callback
from .dispatcher import dispatch_next_question
from .media_metadata import MAX_MEDIA_BYTES, probe_mp4, read_mp4
from .schemas import (
    LiveCurrentOut,
    LiveMakeResultAck,
    LiveMakeResultIn,
    LiveMediaMetadataOut,
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

def _schedule_make(
    request: Request,
    background_tasks: BackgroundTasks,
    live_id: str,
) -> None:
    settings = request.app.state.settings
    if settings.live_make_enabled or settings.live_mock_enabled:
        background_tasks.add_task(
            dispatch_next_question,
            live_id,
            request.app.state.live,
            settings,
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
def start_live(
    live_id: str,
    request: Request,
    background_tasks: BackgroundTasks,
) -> LiveSessionOut:
    live: LiveService = request.app.state.live
    session = live.start_session(live_id)
    _schedule_make(request, background_tasks, live_id)
    return session


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
def submit_live_question(
    live_id: str,
    body: LiveQuestionIn,
    request: Request,
    background_tasks: BackgroundTasks,
) -> LiveQuestionOut:
    live: LiveService = request.app.state.live
    question = live.submit_question(live_id, body)
    _schedule_make(request, background_tasks, live_id)
    return question

@admin_router.post(
    "/{live_id}/questions/{question_id}/skip",
    response_model=LiveQuestionOut,
    dependencies=[Depends(require_csrf)],
)
def skip_live_question(
    live_id: str,
    question_id: str,
    request: Request,
    background_tasks: BackgroundTasks,
) -> LiveQuestionOut:
    live: LiveService = request.app.state.live
    question = live.skip_question(live_id, question_id)
    _schedule_make(request, background_tasks, live_id)
    return question

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
def resume_live(
    live_id: str,
    request: Request,
    background_tasks: BackgroundTasks,
) -> LiveSessionOut:
    live: LiveService = request.app.state.live
    session = live.resume_session(live_id)
    _schedule_make(request, background_tasks, live_id)
    return session

@router.post(
    "/media-metadata",
    response_model=LiveMediaMetadataOut,
    dependencies=[Depends(require_make_callback)],
    openapi_extra={"requestBody": {"required": True, "content": {
        "video/mp4": {"schema": {"type": "string", "format": "binary", "maxLength": MAX_MEDIA_BYTES}},
    }}},
)
async def measure_media_metadata(request: Request) -> LiveMediaMetadataOut:
    content = await read_mp4(request)
    duration = await run_in_threadpool(probe_mp4, content, request.app.state.settings.live_ffprobe_path)
    return LiveMediaMetadataOut(duration_seconds=duration)


@router.post(
    "/make-result",
    response_model=LiveMakeResultAck,
    dependencies=[Depends(require_make_callback)],
)
def receive_make_result(
    body: LiveMakeResultIn,
    request: Request,
    background_tasks: BackgroundTasks,
) -> LiveMakeResultAck:
    if not request.app.state.settings.live_make_enabled or request.app.state.settings.live_mock_enabled:
        raise AppError(503, "live_make_disabled", "Make integration is disabled.")
    live: LiveService = request.app.state.live
    ack = live.receive_make_result(
        body, timeout_seconds=request.app.state.settings.live_make_result_timeout_seconds,
    )

    if ack.reason == "question_skipped" or (
        ack.applied and body.status in ("failed", "skipped")
    ):
        _schedule_make(request, background_tasks, body.live_id)

    return ack
