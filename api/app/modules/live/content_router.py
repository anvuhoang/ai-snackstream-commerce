"""Preparation belongs to the existing live admin, before deliberate host start."""

from fastapi import APIRouter, Depends, Request

from app.core.errors import AppError
from app.modules.auth.deps import require_csrf

from .content import (
    ContentSettings,
    create_audio,
    editable_locked,
    get_content_settings,
    prepared_locked,
)
from .host_media import require_enabled
from .schemas import LiveAudioCreate, LiveContentOut, LiveScriptUpdate

content_router = APIRouter(dependencies=[Depends(require_csrf)])


@content_router.get("/{live_id}/content", response_model=LiveContentOut)
def read_content(live_id: str, request: Request):
    live = request.app.state.live
    with live._lock:
        return prepared_locked(live, live_id).output()


def prepare_audio(live_id, request, config, reviewed_script):
    require_enabled(request.app.state.settings)
    if not config.enabled:
        raise AppError(409, "live_content_disabled", "Live product narration is disabled.")
    live = request.app.state.live
    with live._lock:
        content = editable_locked(live, live_id)
        if content.busy:
            raise AppError(409, "live_content_busy", "Content preparation is in progress.")
        if not content.script or reviewed_script != content.script:
            raise AppError(409, "live_script_review_required", "Review and confirm the exact current script.")
        if content.audio:
            return content.output()
        content.busy = "speaking"
    try:
        # Sync endpoints run in FastAPI's threadpool, without holding the queue/SSE lock.
        result = create_audio(content.script, config)
        with live._lock:
            current = editable_locked(live, live_id)
            if current is not content:
                raise AppError(409, "live_content_stale", "Discarded content for a replaced session.")
            content.audio = result
            live._current.host_audio_ready = True
            live._current.host_audio_duration_seconds = len(result) / 32000
            content.busy = None
            return content.output()
    finally:
        with live._lock:
            if live._host_content is content:
                content.busy = None


@content_router.put("/{live_id}/content/script", response_model=LiveContentOut)
def save_script(
    live_id: str,
    body: LiveScriptUpdate,
    request: Request,
    config: ContentSettings = Depends(get_content_settings),
):
    require_enabled(request.app.state.settings)
    if not config.enabled:
        raise AppError(409, "live_content_disabled", "Live product narration is disabled.")
    live = request.app.state.live
    with live._lock:
        content = editable_locked(live, live_id)
        if content.busy:
            raise AppError(409, "live_content_busy", "Content preparation is in progress.")
        script = body.script or None
        if script != content.script:
            content.script = script
            content.audio = None
            live._current.host_audio_ready = False
            live._current.host_audio_duration_seconds = None
        return content.output()


@content_router.post("/{live_id}/content/audio", response_model=LiveContentOut)
def generate_audio(
    live_id: str,
    body: LiveAudioCreate,
    request: Request,
    config: ContentSettings = Depends(get_content_settings),
):
    return prepare_audio(live_id, request, config, body.script)
