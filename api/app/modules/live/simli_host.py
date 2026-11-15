"""Opt-in, single producer clock. The existing service owns questions and dispatch."""

from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from secrets import compare_digest, token_urlsafe
from typing import TYPE_CHECKING
from uuid import uuid4

from app.core.errors import AppError

from .schemas import LiveHostActionIn, LiveHostOut, LivePlaybackOut

if TYPE_CHECKING:
    from .service import LiveService


@dataclass
class HostPeer:
    key: str
    seen: datetime
    offer_id: str | None = None
    offer: str | None = None
    answer: str | None = None


@dataclass
class SimliHost:
    owner: str
    client_id: str
    lease: str
    epoch: str
    duration: float
    deadline: datetime
    lease_until: datetime
    prepare_until: datetime
    transport: str = "mock"
    phase: str = "preparing"
    offset: float = 0
    saved: float | None = None
    question_id: str | None = None
    revision: int = 0
    token_requested: bool = False
    finish_after: datetime | None = None
    commands: dict = field(default_factory=dict)
    peers: dict[str, HostPeer] = field(default_factory=dict)


def sync(live: "LiveService") -> None:
    h = live._simli_host
    if h is None:
        return
    h.revision += 1
    live._current.host = LiveHostOut(
        transport=h.transport,
        epoch=h.epoch,
        phase=h.phase,
        offset_seconds=h.offset,
        duration_seconds=h.duration,
        saved_offset_seconds=h.saved,
        question_id=h.question_id,
        revision=h.revision,
        lease_expires_at=h.lease_until,
        deadline_at=h.deadline,
    )


def end_locked(live: "LiveService", reason: str) -> None:
    s = live._current
    s.status = "ended"
    live._reply_audio.clear()
    s.playback = None
    live._script_playback = None
    live._active_question_id = None
    for q in s.questions:
        if q.status in ("queued", "processing", "ready", "answering"):
            q.status = "skipped"
    h = live._simli_host
    if h:
        h.phase = "ended"
        sync(live)
        s.host.reason = reason


def advance(live: "LiveService", now: datetime) -> None:
    h = live._simli_host
    if h is None or h.phase == "ended":
        return
    for key, peer in list(h.peers.items()):
        if now - peer.seen >= timedelta(seconds=6):
            del h.peers[key]
    if now >= h.deadline or now >= h.lease_until or (h.phase == "preparing" and now >= h.prepare_until):
        end_locked(live, "host_timeout")
    elif h.phase == "complete" and not any(
        q.status in ("queued", "processing", "ready", "answering") for q in live._current.questions
    ):
        # Bounded media tail budget for the two local receivers. No viewer ACK.
        if h.finish_after is None:
            h.finish_after = now + timedelta(seconds=0.75)
        elif now >= h.finish_after:
            end_locked(live, "script_completed")


def authorize(live: "LiveService", live_id: str, owner: str, client_id: str, lease: str, now: datetime):
    s = live._require_current(live_id)
    advance(live, now)
    h = live._simli_host
    if h is None or h.owner != owner or h.client_id != client_id or not compare_digest(h.lease, lease):
        raise AppError(403, "host_not_owner", "Only the owning producer can control this host.")
    return s, h


def acquire(
    live: "LiveService",
    live_id: str,
    owner: str,
    client_id: str,
    duration: float,
    *,
    audio_sku: str,
    now=None,
    transport="mock",
):
    now = now or datetime.now(UTC)
    with live._lock:
        s = live._require_current(live_id)
        if s.scheduled_skus != [audio_sku] or s.pinned_sku != audio_sku:
            raise AppError(422, "host_audio_sku_mismatch", "Host audio must match the session SKU.")
        if live._simli_slot_until is not None and now < live._simli_slot_until:
            raise AppError(
                409, "host_slot_reserved", "The previous host slot is held for 120 seconds from acquire."
            )
        if s.host_mode != "simli" or s.status != "not_started" or live._simli_host is not None:
            raise AppError(
                409, "host_unavailable", "Host cannot be acquired again. Create a new session after ending."
            )
        live._simli_host = SimliHost(
            owner,
            client_id,
            token_urlsafe(32),
            uuid4().hex,
            duration,
            now + timedelta(seconds=90),
            now + timedelta(seconds=6),
            now + timedelta(seconds=20),
        )
        live._simli_host.transport = transport
        live._simli_slot_until = now + timedelta(seconds=120)
        sync(live)
        return producer_snapshot(live)


def producer_snapshot(live: "LiveService"):
    h = live._simli_host
    return {
        "session": live._current.model_copy(deep=True),
        "leaseId": h.lease,
        "peers": [{"viewerId": key, "offerId": p.offer_id, "answer": p.answer} for key, p in h.peers.items()],
    }


def token_permission(live: "LiveService", live_id, owner, client_id, lease):
    with live._lock:
        _, h = authorize(live, live_id, owner, client_id, lease, datetime.now(UTC))
        if h.phase != "preparing" or h.token_requested:
            raise AppError(409, "host_token_already_requested", "No automatic token retry is permitted.")
        h.token_requested = True


def action(live: "LiveService", live_id: str, owner: str, lease: str, body: LiveHostActionIn, now=None):
    now = now or datetime.now(UTC)
    with live._lock:
        s, h = authorize(live, live_id, owner, body.client_id, lease, now)
        signature = body.model_dump_json()
        if body.request_id in h.commands:
            if h.commands[body.request_id] != signature:
                raise AppError(409, "host_command_conflict", "Request ID was already used with another body.")
            return producer_snapshot(live)
        if h.phase == "ended":
            raise AppError(409, "host_ended", "This host has ended.")
        if len(h.commands) >= 2048:
            raise AppError(409, "host_command_limit", "Host command limit reached.")
        event = body.action
        if event == "heartbeat":
            h.lease_until = min(h.deadline, now + timedelta(seconds=6))
            if h.phase == "script" and body.offset_seconds is not None:
                h.offset = min(h.duration, max(h.offset, body.offset_seconds))
        elif event == "ready":
            if h.phase != "preparing" or not h.token_requested:
                raise AppError(409, "host_not_preparing", "Host is not awaiting ready.")
            s.status = "playing"
            h.phase = "script"
        elif event in ("stop", "error"):
            end_locked(live, "producer_stopped" if event == "stop" else "host_error")
        elif event == "audio_ended":
            if h.phase != "script":
                raise AppError(409, "host_busy", "Host is not playing script.")
            s.script_completed = True
            h.offset = h.duration
            h.phase = "complete"
        else:
            q = next((q for q in s.questions if q.question_id == body.question_id), None)
            if q is None:
                raise AppError(404, "live_question_not_found", "Question not found.")
            if event == "handoff":
                if h.question_id == q.question_id and q.status == "answering":
                    return producer_snapshot(live)
                if (
                    h.phase not in ("script", "complete")
                    or q.status != "ready"
                    or live._active_question_id != q.question_id
                ):
                    raise AppError(409, "host_reply_not_ready", "Only the ready queue slot may play.")
                if body.offset_seconds is None or body.offset_seconds > h.duration:
                    raise AppError(422, "host_invalid_offset", "Observed source offset is required.")
                h.offset = h.saved = body.offset_seconds
                h.question_id = q.question_id
                h.phase = "handoff"
                q.status = "answering"
                s.playback = LivePlaybackOut(
                    playback_id=uuid4().hex,
                    video_url=q.video_url or "",
                    started_at=now,
                    kind="reply",
                    media_source=q.media_source,
                    question_id=q.question_id,
                    duration_seconds=q.audio_duration_seconds
                    if q.reply_kind == "simli_audio"
                    else q.video_duration_seconds,
                )
            elif event == "reply_playing":
                if h.question_id != q.question_id or q.status != "answering":
                    raise AppError(409, "host_reply_inactive", "Reply is inactive.")
                if h.phase == "handoff":
                    h.phase = "reply"
                    s.playback.started_at = now
            elif event == "reply_ended":
                if h.question_id != q.question_id or q.status not in ("answering", "skipped"):
                    raise AppError(409, "host_reply_inactive", "Reply is inactive.")
                h.phase = "restoring"
            elif event == "restored":
                if q.status == "answered":
                    return producer_snapshot(live)
                if h.question_id != q.question_id or h.phase != "restoring" or body.offset_seconds is None:
                    raise AppError(409, "host_restore_inactive", "Restore is inactive.")
                if not max(0, h.saved - 0.6) <= body.offset_seconds <= min(h.duration, h.saved + 0.15):
                    raise AppError(
                        409, "host_restore_offset", "Observed restore offset is outside the safe range."
                    )
                live._reply_audio.pop(q.question_id, None)
                h.offset = body.offset_seconds
                h.phase = "complete" if s.script_completed else "script"
                h.question_id = None
                s.playback = None
                if q.status == "answering":
                    q.status = "answered"
                if live._active_question_id == q.question_id:
                    live._active_question_id = None
        h.commands[body.request_id] = signature
        sync(live)
        advance(live, now)
        return producer_snapshot(live)


def register_viewer(live: "LiveService", live_id: str, viewer_id: str):
    with live._lock:
        s = live._require_current(live_id)
        advance(live, datetime.now(UTC))
        h = live._simli_host
        if s.host_mode != "simli" or h is None or h.phase == "ended":
            raise AppError(409, "host_not_live", "No active producer.")
        if viewer_id in h.peers or len(h.peers) >= 2:
            raise AppError(409, "host_viewer_limit", "Experimental host supports two viewers.")
        key = token_urlsafe(32)
        h.peers[viewer_id] = HostPeer(key, datetime.now(UTC))
        return {"viewerId": viewer_id, "viewerKey": key, "epoch": h.epoch}


def viewer_state(live: "LiveService", live_id, viewer_id, key):
    with live._lock:
        live._require_current(live_id)
        advance(live, datetime.now(UTC))
        h = live._simli_host
        peer = h.peers.get(viewer_id) if h else None
        if peer is None or not compare_digest(peer.key, key):
            raise AppError(403, "host_viewer_unknown", "Unknown viewer.")
        peer.seen = datetime.now(UTC)
        return {
            "epoch": h.epoch,
            "phase": h.phase,
            "offerId": peer.offer_id,
            "offer": peer.offer if h.phase != "ended" else None,
        }


def signal(live: "LiveService", live_id, owner, lease, body):
    with live._lock:
        _, h = authorize(live, live_id, owner, body.client_id, lease, datetime.now(UTC))
        p = h.peers.get(body.viewer_id)
        if h.phase == "ended" or p is None:
            raise AppError(409, "host_viewer_gone", "Viewer is no longer available.")
        if p.offer_id:
            if p.offer_id == body.offer_id and p.offer == body.sdp:
                return
            raise AppError(409, "host_offer_conflict", "Offer already sent; renegotiation is not supported.")
        p.offer_id, p.offer = body.offer_id, body.sdp


def viewer_answer(live: "LiveService", live_id, viewer_id, key, body):
    with live._lock:
        live._require_current(live_id)
        advance(live, datetime.now(UTC))
        h = live._simli_host
        p = h.peers.get(viewer_id) if h else None
        if p is None or not compare_digest(p.key, key):
            raise AppError(403, "host_viewer_unknown", "Unknown viewer.")
        if h.phase == "ended" or p.offer_id != body.offer_id:
            raise AppError(409, "host_offer_stale", "Offer is inactive.")
        if p.answer is not None and p.answer != body.sdp:
            raise AppError(409, "host_answer_conflict", "Answer was already accepted.")
        p.answer = body.sdp
        p.seen = datetime.now(UTC)


def viewer_leave(live: "LiveService", live_id, viewer_id, key):
    with live._lock:
        live._require_current(live_id)
        h = live._simli_host
        p = h.peers.get(viewer_id) if h else None
        if p and compare_digest(p.key, key):
            del h.peers[viewer_id]
