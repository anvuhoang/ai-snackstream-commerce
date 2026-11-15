from datetime import UTC, datetime, timedelta
from unittest.mock import MagicMock

import pytest

from app.core.errors import AppError
from app.modules.live import service as service_module
from app.modules.live.runtime import tick_playback
from app.modules.live.schemas import LiveMakeResultIn, LiveQuestionIn, LiveSessionCreate
from app.modules.live.service import LiveService


def playlist():
    return {
        "title": "Product videos (test data)",
        "scheduledSkus": ["SKU-A", "SKU-B"],
        "scriptPlaylist": [
            {"name": "A", "sku": "sku-a", "videoUrl": "http://127.0.0.1/a.mp4", "durationSeconds": 5.108005},
            {
                "name": "B",
                "sku": "SKU-B",
                "videoUrl": "https://example.invalid/b.mp4",
                "durationSeconds": 4.365011,
            },
        ],
    }


@pytest.fixture()
def running(monkeypatch, settings):
    class Clock(datetime):
        current = datetime(2026, 11, 13, tzinfo=UTC)

        @classmethod
        def now(cls, tz=None):
            return cls.current

    monkeypatch.setattr(service_module, "datetime", Clock)
    monkeypatch.setattr("app.modules.live.dispatcher.send_make_question", MagicMock(return_value=202))
    live = LiveService()
    session = live.create_session(LiveSessionCreate.model_validate(playlist()))
    live.start_session(session.live_id)
    return live, session.live_id, Clock, settings


def question(live, live_id, index=0):
    return live.submit_question(
        live_id,
        LiveQuestionIn(
            question_id=f"playlist-question-{index}", session_id="playlist-viewer", text="Details?"
        ),
    )


def ready(live, live_id, settings):
    settings.live_make_enabled = True
    claimed = live.claim_next_question(live_id)
    result = LiveMakeResultIn(
        live_id=live_id,
        question_id=claimed.question_id,
        sku=claimed.sku,
        status="ready",
        reply_text="Fake provider",
        video_url="https://example.invalid/reply.mp4",
        duration_seconds=2.971995,
    )
    live.receive_make_result(result, settings.live_make_result_timeout_seconds)
    assert live.start_ready_reply(live_id)
    return result


@pytest.mark.parametrize(
    "offset,index,sku", [(5.108004, 0, "SKU-A"), (5.108005, 1, "SKU-B"), (6, 1, "SKU-B")]
)
def test_exact_boundaries_and_late_viewer(running, offset, index, sku):
    live, live_id, clock, settings = running
    start = clock.current
    original = question(live, live_id)
    clock.current += timedelta(seconds=offset)
    tick_playback(live, settings)  # Both provider modes disabled; no viewer needed.
    current = live.get_current()
    assert current.playback.script_index == index
    assert current.playback.media_source == "playlist"
    assert current.pinned_sku == sku
    assert question(live, live_id, 1).sku == sku
    assert current.questions[0].sku == original.sku == "SKU-A"
    assert current.playback.started_at == start + timedelta(seconds=5.108005 if index else 0)


def test_question_on_boundary_gets_new_sku_without_tick(running):
    live, live_id, clock, _ = running
    clock.current += timedelta(seconds=5.108005)
    assert question(live, live_id).sku == "SKU-B"


def test_pause_resume_preserves_segment_position(running):
    live, live_id, clock, settings = running
    clock.current += timedelta(seconds=2)
    live.pause_session(live_id)
    paused = live.get_current()
    clock.current += timedelta(seconds=100)
    tick_playback(live, settings)
    assert live.get_current() == paused
    live.resume_session(live_id)
    assert (clock.current - live.get_current().playback.started_at).total_seconds() == 2
    clock.current += timedelta(seconds=3.108005)
    tick_playback(live, settings)
    assert live.get_current().pinned_sku == "SKU-B"


@pytest.mark.parametrize("action", ["finish", "skip", "paused_skip", "pause_resume"])
def test_reply_restores_exact_segment_and_offset(running, action):
    live, live_id, clock, settings = running
    clock.current += timedelta(seconds=6.5)
    question(live, live_id)
    result = ready(live, live_id, settings)
    reply = live.get_current().playback
    assert (reply.started_at - clock.current).total_seconds() == 5
    if action in ("paused_skip", "pause_resume"):
        clock.current += timedelta(seconds=1)
        live.pause_session(live_id)
        clock.current += timedelta(seconds=60)
    if "skip" in action:
        live.skip_question(live_id, result.question_id)
    else:
        if action == "pause_resume":
            live.resume_session(live_id)
            reply = live.get_current().playback
        clock.current = reply.started_at + timedelta(seconds=reply.duration_seconds)
        tick_playback(live, settings)
    current = live.get_current()
    assert current.playback.kind == "script"
    assert current.playback.script_index == 1
    assert current.pinned_sku == "SKU-B"
    reference = current.playback.paused_at or clock.current
    reference = max(reference, current.playback.resume_at or reference)
    assert (reference - current.playback.started_at).total_seconds() == pytest.approx(1.391995)
    assert live.receive_make_result(result, settings.live_make_result_timeout_seconds).reason == "duplicate"
    assert live.get_current() == current


@pytest.mark.parametrize("completion", ["finish", "skip", "failed", "timeout"])
def test_end_of_playlist_drains_queue_without_cutting_reply_or_reopening(running, completion):
    live, live_id, clock, settings = running
    q = question(live, live_id)
    question(live, live_id, 1)
    if completion in ("finish", "skip"):
        clock.current += timedelta(seconds=9)
        ready(live, live_id, settings)
        clock.current += timedelta(seconds=100)
        assert not live.get_current().script_completed  # Frozen final segment during reply.
        if completion == "skip":
            live.skip_question(live_id, q.question_id)
        else:
            assert live.finish_reply(live_id)
        clock.current = live.get_current().playback.resume_at + timedelta(seconds=0.473016)
    else:
        settings.live_make_enabled = True
        live.claim_next_question(live_id)
        clock.current += timedelta(seconds=10)
    tick_playback(live, settings)
    current = live.get_current()
    assert current.script_completed
    assert current.playback is None
    with pytest.raises(AppError, match="Playlist finished"):
        question(live, live_id, 2)
    if completion == "timeout":
        clock.current += timedelta(seconds=180)
    elif completion == "failed":
        live.receive_make_result(
            LiveMakeResultIn(
                live_id=live_id,
                question_id=q.question_id,
                sku=q.sku,
                status="failed",
                error_code="generation_failed",
            ),
            settings.live_make_result_timeout_seconds,
        )
    tick_playback(live, settings)
    current = live.get_current()
    assert current.questions[1].status == "processing"
    # A reply accepted after the script ends still plays, then returns to no script.
    followup = LiveMakeResultIn(
        live_id=live_id,
        question_id=current.questions[1].question_id,
        sku=current.questions[1].sku,
        status="ready",
        reply_text="Next",
        video_url="https://example.invalid/next.mp4",
        duration_seconds=1,
    )
    live.receive_make_result(followup, settings.live_make_result_timeout_seconds)
    tick_playback(live, settings)
    assert live.get_current().playback.kind == "reply"
    clock.current += timedelta(seconds=6)
    tick_playback(live, settings)
    assert live.get_current().playback is None
    assert all(q.status in ("answered", "failed", "skipped") for q in live.get_current().questions)
    live.pause_session(live_id)
    live.resume_session(live_id)
    assert live.get_current().playback is None
    live.end_session(live_id)
    assert live.get_current().status == "ended"


def test_large_clock_jump_completes_without_loop(running):
    live, _, clock, settings = running
    clock.current += timedelta(days=1)
    tick_playback(live, settings)
    current = live.get_current()
    assert current.script_completed and current.playback is None
    assert current.pinned_sku == "SKU-B"


def test_playlist_sku_cannot_be_manually_overridden(running):
    live, live_id, _, _ = running
    with pytest.raises(AppError) as error:
        live.pin_sku(live_id, "SKU-B")
    assert error.value.code == "live_playlist_controls_sku"


@pytest.mark.parametrize("offset,index", [(5.108005, 1), (9.473016, None)])
def test_ready_on_script_boundary_saves_next_segment_or_completed_state(running, offset, index):
    live, live_id, clock, settings = running
    original = question(live, live_id)
    clock.current += timedelta(seconds=offset)
    result = ready(live, live_id, settings)
    clock.current += timedelta(seconds=7.971995)
    assert live.finish_reply(live_id)
    current = live.get_current()
    assert current.questions[0].sku == original.sku == "SKU-A"
    if index is None:
        assert current.script_completed and current.playback is None
    else:
        assert current.playback.script_index == index
        assert current.playback.started_at == current.playback.resume_at
    assert live.receive_make_result(result, settings.live_make_result_timeout_seconds).reason == "duplicate"


def test_original_question_retry_after_playlist_completed_is_idempotent(running):
    live, live_id, clock, settings = running
    original = question(live, live_id)
    clock.current += timedelta(seconds=10)
    tick_playback(live, settings)
    assert question(live, live_id) == original
    assert len(live.get_current().questions) == 1


@pytest.mark.parametrize(
    "field,value",
    [
        ("sku", "NOT-SCHEDULED"),
        ("name", " "),
        ("durationSeconds", 0),
        ("durationSeconds", -1),
        ("durationSeconds", True),
        ("durationSeconds", "5"),
        ("durationSeconds", float("inf")),
        ("durationSeconds", float("nan")),
        ("durationSeconds", 3601),
        ("videoUrl", "https://user:secret@example.invalid/video.mp4"),
        ("videoUrl", "file:///tmp/video.mp4"),
        ("videoUrl", "javascript:alert(1)"),
    ],
)
def test_invalid_playlist_http_422(signed_in, field, value):
    body = playlist()
    body["scriptPlaylist"][0][field] = value
    # Non-finite values cannot be encoded as JSON; test the model directly for those.
    if field == "durationSeconds" and isinstance(value, float) and not (-float("inf") < value < float("inf")):
        from pydantic import ValidationError

        with pytest.raises(ValidationError):
            LiveSessionCreate.model_validate(body)
    else:
        assert signed_in.post("/api/admin/live", json=body).status_code == 422


def test_http_create_playlist_and_legacy(signed_in):
    created = signed_in.post("/api/admin/live", json=playlist())
    assert created.status_code == 201
    live_id = created.json()["liveId"]
    started = signed_in.post(f"/api/admin/live/{live_id}/start").json()
    assert started["playback"]["mediaSource"] == "playlist"
    assert started["playback"]["durationSeconds"] == 5.108005
    assert started["scriptPlaylist"][0]["sku"] == "SKU-A"
    signed_in.post(f"/api/admin/live/{live_id}/end")
    legacy = signed_in.post("/api/admin/live", json={"title": "Legacy", "scheduledSkus": ["SKU-A"]})
    started = signed_in.post(f"/api/admin/live/{legacy.json()['liveId']}/start").json()
    assert started["playback"]["mediaSource"] == "prerecorded"
    assert started["playback"]["durationSeconds"] is None
    assert not started["scriptCompleted"]


def test_playlist_limit(signed_in):
    body = playlist()
    body["scriptPlaylist"] = body["scriptPlaylist"] * 16
    assert signed_in.post("/api/admin/live", json=body).status_code == 422
