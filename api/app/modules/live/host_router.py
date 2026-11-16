from datetime import UTC, datetime
from secrets import compare_digest

from fastapi import APIRouter, Depends, Header, Request, Response

from app.modules.auth.deps import current_admin, require_csrf

from . import simli_host
from .content import ContentSettings, bound_audio_locked, get_content_settings
from .host_media import (
    configured_audio_sku,
    mock_video_bytes,
    require_enabled,
    session_token,
)
from .schemas import (
    LiveHostActionIn,
    LiveHostAnswerIn,
    LiveHostCapabilitiesOut,
    LiveHostClientIn,
    LiveHostOfferIn,
    LiveHostProducerOut,
    LiveHostTokenOut,
    LiveHostViewerOut,
    LiveHostViewerStateOut,
)

host_admin_router = APIRouter(dependencies=[Depends(require_csrf)])
host_public_router = APIRouter()


@host_admin_router.get("/host-capabilities", response_model=LiveHostCapabilitiesOut)
def capabilities(request: Request, config: ContentSettings = Depends(get_content_settings)):
    s = request.app.state.settings
    return {
        "enabled": s.live_simli_enabled,
        "contentEnabled": s.live_simli_enabled and config.enabled,
        "audioConfigured": config.audio_configured,
        "transport": s.live_simli_transport,
        "audioSku": configured_audio_sku(s) if s.live_simli_enabled else None,
    }


@host_admin_router.post("/{live_id}/host/acquire", response_model=LiveHostProducerOut)
def acquire(live_id: str, body: LiveHostClientIn, request: Request, user=Depends(current_admin)):
    settings = request.app.state.settings
    live = request.app.state.live
    with live._lock:
        sku, data = bound_audio_locked(live, settings, live._require_current(live_id))
    return simli_host.acquire(
        request.app.state.live,
        live_id,
        str(user.id),
        body.client_id,
        len(data) / 32000,
        transport=settings.live_simli_transport,
        audio_sku=sku,
    )


@host_admin_router.post("/{live_id}/host/token", response_model=LiveHostTokenOut)
def token(
    live_id: str,
    body: LiveHostClientIn,
    request: Request,
    user=Depends(current_admin),
    x_live_host_lease: str = Header(),
):
    settings = request.app.state.settings
    require_enabled(settings)
    live = request.app.state.live
    with live._lock:
        session = live._require_current(live_id)
        bound_audio_locked(live, settings, session)
    simli_host.token_permission(live, live_id, str(user.id), body.client_id, x_live_host_lease)
    try:
        result = session_token(settings)
        with live._lock:
            _, h = simli_host.authorize(
                live, live_id, str(user.id), body.client_id, x_live_host_lease, datetime.now(UTC)
            )
            if h.phase == "ended":
                from app.core.errors import AppError

                raise AppError(409, "host_ended", "Host expired during startup.")
        return {"transport": settings.live_simli_transport, "sessionToken": result}
    except Exception:
        with live._lock:
            if (
                live._current is not None
                and live._current.live_id == live_id
                and live._simli_host is not None
                and compare_digest(live._simli_host.lease, x_live_host_lease)
            ):
                simli_host.end_locked(live, "host_start_failed")
        raise


@host_admin_router.post("/{live_id}/host/audio")
def audio(
    live_id: str,
    body: LiveHostClientIn,
    request: Request,
    user=Depends(current_admin),
    x_live_host_lease: str = Header(),
):
    live = request.app.state.live
    with live._lock:
        _, h = simli_host.authorize(
            live, live_id, str(user.id), body.client_id, x_live_host_lease, datetime.now(UTC)
        )
        if h.phase == "ended":
            from app.core.errors import AppError

            raise AppError(409, "host_ended", "Host has ended.")
        _, data = bound_audio_locked(live, request.app.state.settings, live._current)
    return Response(
        data,
        media_type="application/octet-stream",
        headers={"Cache-Control": "no-store"},
    )


@host_admin_router.post("/{live_id}/host/reply-audio/{question_id}")
def reply_audio(
    live_id: str,
    question_id: str,
    body: LiveHostClientIn,
    request: Request,
    user=Depends(current_admin),
    x_live_host_lease: str = Header(),
):
    from app.core.errors import AppError

    live = request.app.state.live
    with live._lock:
        s, h = simli_host.authorize(
            live, live_id, str(user.id), body.client_id, x_live_host_lease, datetime.now(UTC)
        )
        q = next((q for q in s.questions if q.question_id == question_id), None)
        if (
            h.phase == "ended"
            or q is None
            or q.status not in ("ready", "answering")
            or q.reply_kind != "simli_audio"
            or live._active_question_id != question_id
        ):
            raise AppError(409, "live_reply_inactive", "Reply audio is no longer active.")
        data = live._reply_audio.get(question_id)
        if not data:
            raise AppError(409, "live_reply_audio_missing", "Reply audio is unavailable.")
    return Response(data, media_type="application/octet-stream", headers={"Cache-Control": "no-store"})


@host_admin_router.post("/{live_id}/host/action", response_model=LiveHostProducerOut)
def action(
    live_id: str,
    body: LiveHostActionIn,
    request: Request,
    user=Depends(current_admin),
    x_live_host_lease: str = Header(),
):
    return simli_host.action(request.app.state.live, live_id, str(user.id), x_live_host_lease, body)


@host_admin_router.post("/{live_id}/host/offer", status_code=204)
def offer(
    live_id: str,
    body: LiveHostOfferIn,
    request: Request,
    user=Depends(current_admin),
    x_live_host_lease: str = Header(),
):
    simli_host.signal(request.app.state.live, live_id, str(user.id), x_live_host_lease, body)
    return Response(status_code=204)


@host_public_router.post("/{live_id}/host/viewers", response_model=LiveHostViewerOut)
def register(live_id: str, body: LiveHostClientIn, request: Request):
    return simli_host.register_viewer(request.app.state.live, live_id, body.client_id)


@host_public_router.get("/{live_id}/host/viewers/{viewer_id}", response_model=LiveHostViewerStateOut)
def viewer(live_id: str, viewer_id: str, request: Request, x_live_viewer_key: str = Header()):
    return simli_host.viewer_state(request.app.state.live, live_id, viewer_id, x_live_viewer_key)


@host_public_router.post("/{live_id}/host/viewers/{viewer_id}/answer", status_code=204)
def answer(
    live_id: str, viewer_id: str, body: LiveHostAnswerIn, request: Request, x_live_viewer_key: str = Header()
):
    simli_host.viewer_answer(request.app.state.live, live_id, viewer_id, x_live_viewer_key, body)
    return Response(status_code=204)


@host_public_router.post("/{live_id}/host/viewers/{viewer_id}/leave", status_code=204)
def leave(live_id: str, viewer_id: str, request: Request, x_live_viewer_key: str = Header()):
    simli_host.viewer_leave(request.app.state.live, live_id, viewer_id, x_live_viewer_key)
    return Response(status_code=204)


@host_admin_router.post("/{live_id}/host/mock-video")
def mock_video(
    live_id: str,
    body: LiveHostClientIn,
    request: Request,
    user=Depends(current_admin),
    x_live_host_lease: str = Header(),
):
    live = request.app.state.live
    with live._lock:
        _, h = simli_host.authorize(
            live, live_id, str(user.id), body.client_id, x_live_host_lease, datetime.now(UTC)
        )
        if h.phase == "ended":
            from app.core.errors import AppError

            raise AppError(409, "host_ended", "Host has ended.")
    return Response(
        mock_video_bytes(request.app.state.settings),
        media_type="video/mp4",
        headers={"Cache-Control": "no-store"},
    )
