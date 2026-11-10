import asyncio
import time
from datetime import UTC, datetime, timedelta
from unittest.mock import MagicMock

import pytest
from fastapi.testclient import TestClient

from app.main import create_app
from app.modules.live import service as service_module
from app.modules.live.runtime import run_mock_playback, tick_mock_playback
from app.modules.live.schemas import LiveQuestionIn, LiveSessionCreate
from app.modules.live.service import LiveService


@pytest.fixture
def runtime_live(settings, monkeypatch):
    class Clock(datetime):
        current = datetime(2026, 11, 11, tzinfo=UTC)

        @classmethod
        def now(cls, tz=None):
            return cls.current if tz is not None else cls.current.replace(tzinfo=None)

    monkeypatch.setattr(service_module, "datetime", Clock)
    settings.live_mock_enabled = True
    sender = MagicMock(side_effect=AssertionError("Mock mode must not call Make"))
    monkeypatch.setattr("app.modules.live.dispatcher.send_make_question", sender)
    live = LiveService()
    session = live.create_session(
        LiveSessionCreate(title="Runtime test", scheduled_skus=["BT-XIKE-01"])
    )
    live.start_session(session.live_id)
    Clock.current += timedelta(seconds=4)
    for index in range(2):
        live.submit_question(
            session.live_id,
            LiveQuestionIn(
                question_id=f"runtime-question-{index}",
                session_id="runtime-viewer-001",
                text=f"Question {index}",
            ),
        )
    return live, settings, Clock, sender


def test_ticks_process_queue_in_order_and_restore_script_without_viewers(runtime_live):
    live, settings, clock, sender = runtime_live
    for index in range(2):
        tick_mock_playback(live, settings)
        current = live.get_current()
        assert current.playback.kind == "reply"
        assert current.playback.question_id == f"runtime-question-{index}"
        assert sum(q.status == "answering" for q in current.questions) == 1
        clock.current = current.playback.started_at + timedelta(
            seconds=current.playback.duration_seconds
        )
        tick_mock_playback(live, settings)
        current = live.get_current()
        assert current.playback.kind == "script"
        assert (clock.current - current.playback.started_at).total_seconds() == 4
    assert [q.status for q in current.questions] == ["answered", "answered"]
    sender.assert_not_called()


def test_paused_queue_and_paused_reply_do_not_advance(runtime_live):
    live, settings, clock, sender = runtime_live
    live_id = live.get_current().live_id
    live.pause_session(live_id)
    before = live.get_current()
    tick_mock_playback(live, settings)
    assert live.get_current() == before
    live.resume_session(live_id)
    tick_mock_playback(live, settings)
    live.pause_session(live_id)
    before = live.get_current()
    clock.current += timedelta(seconds=100)
    tick_mock_playback(live, settings)
    assert live.get_current() == before
    sender.assert_not_called()


@pytest.mark.parametrize("mode", ["disabled", "conflict"])
def test_runtime_never_calls_make_even_with_changed_settings(runtime_live, mode):
    live, settings, clock, sender = runtime_live
    if mode == "disabled":
        settings.live_mock_enabled = False
    else:
        settings.live_make_enabled = True
    before = live.get_current()
    tick_mock_playback(live, settings)
    assert live.get_current() == before
    sender.assert_not_called()


def test_empty_or_ended_session_is_ignored(runtime_live):
    live, settings, clock, sender = runtime_live
    tick_mock_playback(LiveService(), settings)
    live.end_session(live.get_current().live_id)
    before = live.get_current()
    tick_mock_playback(live, settings)
    assert live.get_current() == before
    sender.assert_not_called()


def test_runtime_task_cancels_cleanly(settings):
    settings.live_mock_enabled = True

    async def check():
        task = asyncio.create_task(run_mock_playback(LiveService(), settings))
        await asyncio.sleep(0)
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await asyncio.wait_for(task, timeout=1)

    asyncio.run(check())


def test_app_lifespan_runs_queue_automatically_and_stops_on_exit(settings, monkeypatch):
    settings.live_mock_enabled = True
    settings.live_mock_video_duration_seconds = 0.05
    sender = MagicMock(side_effect=AssertionError("Mock mode must not call Make"))
    monkeypatch.setattr("app.modules.live.dispatcher.send_make_question", sender)
    with TestClient(create_app(settings)) as client:
        live = client.app.state.live
        session = live.create_session(
            LiveSessionCreate(title="Automatic runtime test", scheduled_skus=["BT-XIKE-01"])
        )
        live.start_session(session.live_id)
        for index in range(2):
            client.post(
                f"/api/live/{session.live_id}/questions",
                json={
                    "questionId": f"automatic-question-{index}",
                    "sessionId": "automatic-viewer-001",
                    "text": f"Question {index}",
                },
            ).raise_for_status()
        deadline = time.monotonic() + 5
        while time.monotonic() < deadline:
            state = client.get("/api/live/current").json()["session"]
            assert sum(q["status"] == "answering" for q in state["questions"]) <= 1
            if all(q["status"] == "answered" for q in state["questions"]):
                break
            time.sleep(0.01)
        else:
            pytest.fail("Background runtime did not finish both questions")
        assert state["playback"]["kind"] == "script"
        sender.assert_not_called()
