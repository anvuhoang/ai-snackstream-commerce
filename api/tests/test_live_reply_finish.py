from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime, timedelta

import pytest

from app.modules.live import service as live_service
from app.modules.live.schemas import LiveQuestionIn, LiveSessionCreate
from app.modules.live.service import LiveService


@pytest.fixture
def answering_live(monkeypatch):
    class Clock(datetime):
        current = datetime(2026, 11, 10, tzinfo=UTC)

        @classmethod
        def now(cls, tz=None):
            return cls.current if tz is not None else cls.current.replace(tzinfo=None)

    monkeypatch.setattr(live_service, "datetime", Clock)
    service = LiveService()
    session = service.create_session(
        LiveSessionCreate(title="Reply finish test", scheduled_skus=["BT-XIKE-01"])
    )
    service.start_session(session.live_id)
    Clock.current += timedelta(seconds=5)
    for index in range(2):
        service.submit_question(
            session.live_id,
            LiveQuestionIn(
                question_id=f"finish-question-{index}",
                session_id="finish-viewer-001",
                text=f"Question {index}",
            ),
        )
    service.claim_next_question(session.live_id)
    service.complete_mock_question(session.live_id, "finish-question-0", 10.077007)
    assert service.start_ready_reply(session.live_id)
    return service, session.live_id, Clock


def elapsed_script(current, clock):
    reference = current.playback.paused_at or clock.current
    reference = max(reference, current.playback.resume_at or reference)
    return (reference - current.playback.started_at).total_seconds()


def set_deadline(service, clock):
    reply = service.get_current().playback
    clock.current = reply.started_at + timedelta(seconds=reply.duration_seconds)


def test_finish_waits_for_deadline_and_restores_exact_script_position(answering_live):
    service, live_id, clock = answering_live
    reply_id = service.get_current().playback.playback_id
    set_deadline(service, clock)
    clock.current -= timedelta(microseconds=1)
    before = service.get_current()
    assert not service.finish_reply(live_id)
    assert service.get_current() == before
    clock.current += timedelta(microseconds=1)
    assert service.finish_reply(live_id)
    current = service.get_current()
    assert current.playback.kind == "script"
    assert current.playback.playback_id != reply_id
    assert current.playback.question_id is None
    assert current.questions[0].status == "answered"
    assert elapsed_script(current, clock) == 5
    before = service.get_current()
    assert not service.finish_reply(live_id)
    assert service.get_current() == before


def test_pause_does_not_count_toward_reply_duration(answering_live):
    service, live_id, clock = answering_live
    clock.current = service.get_current().playback.started_at + timedelta(seconds=3)
    service.pause_session(live_id)
    clock.current += timedelta(seconds=100)
    before = service.get_current()
    assert not service.finish_reply(live_id)
    assert service.get_current() == before
    service.resume_session(live_id)
    assert not service.finish_reply(live_id)
    set_deadline(service, clock)
    assert service.finish_reply(live_id)
    assert elapsed_script(service.get_current(), clock) == 5


def test_skipping_playing_reply_restores_script_and_releases_queue(answering_live):
    service, live_id, clock = answering_live
    clock.current = service.get_current().playback.started_at + timedelta(seconds=2)
    skipped = service.skip_question(live_id, "finish-question-0")
    assert skipped.status == "skipped"
    current = service.get_current()
    assert current.playback.kind == "script"
    assert elapsed_script(current, clock) == 5
    assert not service.finish_reply(live_id)
    assert service.claim_next_question(live_id).question_id == "finish-question-1"


def test_skipping_paused_reply_keeps_script_paused_at_saved_position(answering_live):
    service, live_id, clock = answering_live
    clock.current = service.get_current().playback.started_at + timedelta(seconds=2)
    service.pause_session(live_id)
    clock.current += timedelta(seconds=50)
    service.skip_question(live_id, "finish-question-0")
    current = service.get_current()
    assert current.status == "paused"
    assert current.playback.kind == "script"
    assert elapsed_script(current, clock) == 5
    assert service.claim_next_question(live_id) is None
    clock.current += timedelta(seconds=30)
    service.resume_session(live_id)
    assert elapsed_script(service.get_current(), clock) == 5


def test_next_reply_can_run_after_completion_without_losing_script_position(answering_live):
    service, live_id, clock = answering_live
    set_deadline(service, clock)
    assert service.finish_reply(live_id)
    assert service.claim_next_question(live_id).question_id == "finish-question-1"
    service.complete_mock_question(live_id, "finish-question-1", 10.077007)
    clock.current = service.get_current().playback.resume_at + timedelta(seconds=2)
    assert service.start_ready_reply(live_id)
    set_deadline(service, clock)
    assert service.finish_reply(live_id)
    current = service.get_current()
    assert [q.status for q in current.questions] == ["answered", "answered"]
    assert elapsed_script(current, clock) == 7


def test_concurrent_finishes_apply_once(answering_live):
    service, live_id, clock = answering_live
    set_deadline(service, clock)
    with ThreadPoolExecutor(max_workers=8) as pool:
        results = list(pool.map(lambda _: service.finish_reply(live_id), range(8)))
    assert sum(results) == 1
    assert elapsed_script(service.get_current(), clock) == 5


def test_stale_or_ended_session_cannot_restore_video(answering_live):
    service, live_id, clock = answering_live
    set_deadline(service, clock)
    before = service.get_current()
    assert not service.finish_reply("old-live-id")
    assert service.get_current() == before
    service.end_session(live_id)
    assert not service.finish_reply(live_id)
    assert service.get_current().playback is None
    assert service.get_current().questions[0].status == "skipped"


def test_answered_question_cannot_be_skipped_or_replayed(answering_live):
    service, live_id, clock = answering_live
    set_deadline(service, clock)
    service.finish_reply(live_id)
    before = service.get_current()
    assert service.skip_question(live_id, "finish-question-0").status == "answered"
    assert not service.start_ready_reply(live_id)
    assert service.get_current() == before
