from datetime import UTC, datetime, timedelta

import pytest

from app.core.errors import AppError
from app.modules.live import service as service_module
from app.modules.live.schemas import LiveMakeResultIn, LiveQuestionIn, LiveSessionCreate
from app.modules.live.service import (
    REPLY_PREPARATION_SECONDS,
    SCRIPT_RESTORE_PREPARATION_SECONDS,
    LiveService,
)


@pytest.fixture(params=[("playlist", "make"), ("playlist", "mock"), ("legacy", "make"), ("legacy", "mock")])
def answering(request, monkeypatch, settings):
    class Clock(datetime):
        current = datetime(2026, 11, 13, tzinfo=UTC)

        @classmethod
        def now(cls, tz=None):
            return cls.current

    monkeypatch.setattr(service_module, "datetime", Clock)
    layout, mode = request.param
    settings.live_make_enabled = mode == "make"
    settings.live_mock_enabled = mode == "mock"
    live = LiveService()
    playlist = (
        [
            {
                "name": "Alpha",
                "sku": "SKU-ALPHA",
                "videoUrl": "http://127.0.0.1/alpha.mp4",
                "durationSeconds": 30.766054,
            },
            {
                "name": "Beta",
                "sku": "SKU-BETA",
                "videoUrl": "http://127.0.0.1/beta.mp4",
                "durationSeconds": 61.41644,
            },
        ]
        if layout == "playlist"
        else []
    )
    session = live.create_session(
        LiveSessionCreate.model_validate(
            {
                "title": "Restore clock",
                "scheduledSkus": ["SKU-ALPHA", "SKU-BETA"],
                "scriptPlaylist": playlist,
            }
        )
    )
    live_id = session.live_id
    live.start_session(live_id)
    Clock.current += timedelta(seconds=30.766054 if playlist else 0)
    if not playlist:
        live.pin_sku(live_id, "SKU-BETA")
    Clock.current += timedelta(seconds=6.926)
    script = live.get_current().playback
    for i in range(3):
        live.submit_question(
            live_id,
            LiveQuestionIn(
                question_id=f"restore-question-{i}",
                session_id="restore-viewer-001",
                text="Test question",
            ),
        )
    live.claim_next_question(live_id)
    result = complete(live, live_id, 0, mode)
    assert live.start_ready_reply(live_id)
    assert live.get_current().playback.started_at == Clock.current + timedelta(seconds=5)
    return live, live_id, Clock, settings, script, mode, result


def complete(live, live_id, index, mode):
    result = LiveMakeResultIn(
        live_id=live_id,
        question_id=f"restore-question-{index}",
        sku="SKU-BETA",
        status="ready",
        reply_text="Fake provider",
        video_url="https://example.invalid/reply.mp4",
        duration_seconds=10.077007,
    )
    if mode == "make":
        assert live.receive_make_result(result, 180).applied
    else:
        assert live.complete_mock_question(live_id, result.question_id, result.duration_seconds)
    return result


def finish(live, live_id, clock):
    reply = live.get_current().playback
    clock.current = reply.started_at + timedelta(seconds=reply.duration_seconds)
    assert live.finish_reply(live_id)
    return live.get_current().playback


def position(playback, now):
    reference = playback.paused_at or now
    return (max(reference, playback.resume_at or reference) - playback.started_at).total_seconds()


def test_restore_holds_exact_content_until_shared_gate_without_viewers(answering):
    live, live_id, clock, _, original, _, _ = answering
    restored = finish(live, live_id, clock)
    now = clock.current
    assert SCRIPT_RESTORE_PREPARATION_SECONDS == REPLY_PREPARATION_SECONDS == 5
    assert restored.resume_at == now + timedelta(seconds=5)
    assert restored.video_url == original.video_url
    assert restored.script_index == original.script_index
    assert restored.duration_seconds == original.duration_seconds
    assert restored.playback_id != original.playback_id
    assert position(restored, now) == 6.926
    assert live.get_current().pinned_sku == "SKU-BETA"
    for elapsed in [0, 1, 4.999999, 5]:
        clock.current = now + timedelta(seconds=elapsed)
        assert position(live.get_current().playback, clock.current) == 6.926
    clock.current += timedelta(seconds=0.7)
    assert position(live.get_current().playback, clock.current) == 7.626


@pytest.mark.parametrize("pause_after", [2, 6.25])
def test_pause_resume_shifts_gate_and_origin_together(answering, pause_after):
    live, live_id, clock, _, _, _, _ = answering
    restored = finish(live, live_id, clock)
    clock.current += timedelta(seconds=pause_after)
    expected = position(restored, clock.current)
    live.pause_session(live_id)
    paused = live.get_current()
    clock.current += timedelta(seconds=120)
    assert live.get_current() == paused
    live.resume_session(live_id)
    current = live.get_current().playback
    assert current.resume_at == restored.resume_at + timedelta(seconds=120)
    assert current.started_at == restored.started_at + timedelta(seconds=120)
    assert position(current, clock.current) == expected


@pytest.mark.parametrize("paused", [False, True])
def test_skip_restores_with_bounded_preparation_and_end_cancels(answering, paused):
    live, live_id, clock, _, _, _, _ = answering
    clock.current += timedelta(seconds=1)  # Still in the unchanged reply preparation window.
    if paused:
        live.pause_session(live_id)
        clock.current += timedelta(seconds=60)
    live.skip_question(live_id, "restore-question-0")
    restored = live.get_current().playback
    assert restored.resume_at == clock.current + timedelta(seconds=5)
    assert position(restored, clock.current) == 6.926
    assert bool(restored.paused_at) == paused
    live.end_session(live_id)
    clock.current += timedelta(seconds=100)
    assert live.get_current().playback is None
    assert not live.start_ready_reply(live_id)


@pytest.mark.parametrize("preempt_after", [0, 2, 5, 7])
def test_next_reply_preempting_restore_keeps_saved_offset_and_idempotency(answering, preempt_after):
    live, live_id, clock, _, _, mode, first_result = answering
    finish(live, live_id, clock)
    clock.current += timedelta(seconds=preempt_after)
    assert live.claim_next_question(live_id).question_id == "restore-question-1"
    second_result = complete(live, live_id, 1, mode)
    assert live.start_ready_reply(live_id)
    assert live.get_current().playback.started_at == clock.current + timedelta(seconds=5)
    restored = finish(live, live_id, clock)
    assert position(restored, clock.current) == 6.926 + max(0, preempt_after - 5)
    assert [q.status for q in live.get_current().questions[:2]] == ["answered", "answered"]
    if mode == "make":
        before = live.get_current()
        clock.current += timedelta(seconds=181)
        for result in [first_result, second_result]:
            assert live.receive_make_result(result, 180).reason == "duplicate"
        # Cached callbacks do not replace the current playback, including after the claim deadline.
        assert live.get_current().questions == before.questions
        if not before.script_playlist:
            assert live.get_current().playback == before.playback


@pytest.mark.parametrize("answering", [("playlist", "make"), ("legacy", "make")], indirect=True)
def test_next_claim_deadline_continues_during_restore_and_pause(answering):
    live, live_id, clock, _, _, mode, _ = answering
    restored = finish(live, live_id, clock)
    claimed = live.claim_next_question(live_id)
    assert claimed.processing_started_at == clock.current
    live.pause_session(live_id)
    clock.current += timedelta(seconds=3)
    assert live.expire_make_question(live_id, 3)
    assert live.get_current().questions[1].error_code == "generation_timeout"
    assert live.get_current().playback.resume_at == restored.resume_at
    with pytest.raises(AppError) as error:
        live.receive_make_result(
            LiveMakeResultIn(
                live_id=live_id,
                question_id=claimed.question_id,
                sku=claimed.sku,
                status="ready",
                reply_text="Late",
                video_url="https://example.invalid/late.mp4",
                duration_seconds=1,
            ),
            3,
        )
    assert error.value.code == "live_question_not_active"


@pytest.mark.parametrize("answering", [("playlist", "make"), ("playlist", "mock")], indirect=True)
def test_near_segment_end_waits_then_plays_remaining_content(answering):
    live, live_id, clock, _, original, _, _ = answering
    # Move the saved internal script to 0.1 seconds before its actual end.
    # This is a fake-clock service test, not a duration change or browser-only hold.
    remaining = timedelta(seconds=0.1)
    saved_script = live._script_playback
    saved_script.started_at = (
        saved_script.paused_at - timedelta(seconds=original.duration_seconds) + remaining
    )
    restored = finish(live, live_id, clock)
    clock.current = restored.resume_at - timedelta(microseconds=1)
    assert live.get_current().playback.script_index == 1
    clock.current = restored.resume_at + remaining - timedelta(microseconds=1)
    assert live.get_current().playback.script_index == 1
    clock.current += timedelta(microseconds=1)
    assert live.get_current().script_completed
    assert live.get_current().playback is None
    # Accepted queued work still plays after completion, with no phantom script to restore.
    live.claim_next_question(live_id)
    complete(live, live_id, 1, "make" if live.get_current().questions[0].media_source == "make" else "mock")
    assert live.start_ready_reply(live_id)
    assert finish(live, live_id, clock) is None
    assert live.claim_next_question(live_id).question_id == "restore-question-2"
