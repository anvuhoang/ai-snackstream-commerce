from datetime import UTC, datetime, timedelta
from unittest.mock import MagicMock

import pytest

from app.modules.live import service as service_module
from app.modules.live.runtime import tick_playback
from app.modules.live.schemas import LiveMakeResultIn, LiveQuestionIn, LiveSessionCreate
from app.modules.live.service import REPLY_PREPARATION_SECONDS, LiveService


@pytest.fixture(params=["make", "prerecorded"])
def preparing(request, settings, monkeypatch):
    class Clock(datetime):
        current = datetime(2026, 11, 11, tzinfo=UTC)

        @classmethod
        def now(cls, tz=None):
            return cls.current if tz is not None else cls.current.replace(tzinfo=None)

    monkeypatch.setattr(service_module, "datetime", Clock)
    settings.live_make_enabled = request.param == "make"
    settings.live_mock_enabled = request.param == "prerecorded"
    settings.live_mock_video_duration_seconds = 5.108005
    sender = MagicMock(return_value=202)
    monkeypatch.setattr("app.modules.live.dispatcher.send_make_question", sender)
    live = LiveService()
    session = live.create_session(LiveSessionCreate(title="Preparation", scheduled_skus=["BT-XIKE-01"]))
    live.start_session(session.live_id)
    Clock.current += timedelta(seconds=7)
    for i in range(2):
        live.submit_question(
            session.live_id,
            LiveQuestionIn(
                question_id=f"prepare-question-{i}",
                session_id="prepare-viewer-001",
                text="Question",
            ),
        )
    result = LiveMakeResultIn(
        live_id=session.live_id,
        question_id="prepare-question-0",
        sku="BT-XIKE-01",
        status="ready",
        reply_text="Existing MP4",
        video_url="https://example.invalid/reply.mp4",
        duration_seconds=5.108005,
    )
    tick_playback(live, settings)
    if settings.live_make_enabled:
        assert live.receive_make_result(result, settings.live_make_result_timeout_seconds).applied
        tick_playback(live, settings)
    return live, session.live_id, settings, Clock, result


def test_shared_preparation_and_full_duration_finish_without_any_viewer(preparing):
    live, live_id, settings, clock, result = preparing
    prepared_at = clock.current
    reply = live.get_current().playback
    assert reply.started_at == prepared_at + timedelta(seconds=REPLY_PREPARATION_SECONDS)
    assert REPLY_PREPARATION_SECONDS == 5
    assert reply.duration_seconds == 5.108005
    assert live.claim_next_question(live_id) is None
    for instant in [
        prepared_at + timedelta(seconds=3),
        reply.started_at,
        reply.started_at + timedelta(seconds=reply.duration_seconds, microseconds=-1),
    ]:
        clock.current = instant
        tick_playback(live, settings)
        assert live.get_current().playback == reply
        assert live.get_current().questions[0].status == "answering"
    clock.current += timedelta(microseconds=1)
    tick_playback(live, settings)
    current = live.get_current()
    assert current.questions[0].status == "answered"
    assert current.playback.kind == "script"
    assert (clock.current - current.playback.started_at).total_seconds() == 7
    if settings.live_make_enabled:
        ack = live.receive_make_result(result, settings.live_make_result_timeout_seconds)
        assert ack.reason == "duplicate"
        assert live.get_current() == current


def test_pause_during_preparation_preserves_remaining_window_and_media_duration(preparing):
    live, live_id, settings, clock, _ = preparing
    original = live.get_current().playback
    clock.current += timedelta(seconds=1)
    live.pause_session(live_id)
    paused = live.get_current()
    assert (original.started_at - paused.playback.paused_at).total_seconds() == 4
    clock.current += timedelta(seconds=100)
    tick_playback(live, settings)
    assert live.get_current() == paused
    live.resume_session(live_id)
    reply = live.get_current().playback
    assert reply.playback_id == original.playback_id
    assert reply.started_at == original.started_at + timedelta(seconds=100)
    assert (reply.started_at - clock.current).total_seconds() == 4
    clock.current = reply.started_at + timedelta(seconds=reply.duration_seconds)
    tick_playback(live, settings)
    assert live.get_current().questions[0].status == "answered"
    assert (clock.current - live.get_current().playback.started_at).total_seconds() == 7


@pytest.mark.parametrize("action", ["skip", "paused_skip", "end"])
def test_preparation_skip_end_never_start_old_reply_and_next_gets_own_window(preparing, action):
    live, live_id, settings, clock, result = preparing
    old = live.get_current().playback
    clock.current += timedelta(seconds=1)
    if action == "paused_skip":
        live.pause_session(live_id)
    if action == "end":
        live.end_session(live_id)
    else:
        live.skip_question(live_id, "prepare-question-0")
    current = live.get_current()
    assert current.playback is None if action == "end" else current.playback.kind == "script"
    clock.current += timedelta(seconds=100)
    tick_playback(live, settings)
    assert not live.finish_reply(live_id)
    if settings.live_make_enabled:
        ack = live.receive_make_result(result, settings.live_make_result_timeout_seconds)
        assert ack.reason == ("session_ended" if action == "end" else "duplicate")
    if action == "end":
        assert live.get_current().playback is None
    elif action == "paused_skip":
        assert live.get_current() == current
        live.resume_session(live_id)
        tick_playback(live, settings)
    else:
        assert live.get_current().playback.playback_id != old.playback_id
    if action != "end":
        current = live.get_current()
        if settings.live_mock_enabled:
            assert current.playback.question_id == "prepare-question-1"
            assert current.playback.started_at == clock.current + timedelta(seconds=5)
        else:
            assert current.questions[1].status == "processing"
