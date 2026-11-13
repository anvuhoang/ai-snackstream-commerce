import asyncio
import threading
import time
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest
from fastapi.testclient import TestClient
from pydantic import SecretStr, ValidationError
from starlette.requests import Request

from app.core.config import Settings
from app.core.errors import AppError
from app.main import create_app
from app.modules.live import service as service_module
from app.modules.live.router import live_events
from app.modules.live.runtime import run_playback, tick_playback
from app.modules.live.schemas import LiveMakeResultIn, LiveQuestionIn, LiveSessionCreate
from app.modules.live.service import LiveService


def result(live_id, index=0, **changes):
    return LiveMakeResultIn.model_validate(
        {
            "liveId": live_id,
            "questionId": f"make-question-{index}",
            "sku": "BT-XIKE-01",
            "status": "ready",
            "replyText": "Synthetic provider reply; not generated speech.",
            "videoUrl": "https://provider.example.invalid/reply.mp4",
            "durationSeconds": 5.25,
            **changes,
        }
    )


@pytest.fixture
def make_live(settings, monkeypatch):
    class Clock(datetime):
        current = datetime(2026, 11, 11, tzinfo=UTC)

        @classmethod
        def now(cls, tz=None):
            return cls.current if tz is not None else cls.current.replace(tzinfo=None)

    monkeypatch.setattr(service_module, "datetime", Clock)
    settings.live_make_enabled = True
    settings.live_make_result_timeout_seconds = 30
    sender = MagicMock(return_value=202)
    monkeypatch.setattr("app.modules.live.dispatcher.send_make_question", sender)
    live = LiveService()
    session = live.create_session(
        LiveSessionCreate(
            title="Make fake-provider playback",
            scheduled_skus=["BT-XIKE-01", "KG-LC-250"],
        )
    )
    live.start_session(session.live_id)
    Clock.current += timedelta(seconds=4)
    for index in range(3):
        live.submit_question(
            session.live_id,
            LiveQuestionIn(
                question_id=f"make-question-{index}",
                session_id="make-viewer-001",
                text=f"Question {index}",
            ),
        )
    return live, settings, Clock, sender, session.live_id


def start_reply(live, settings, live_id, index=0):
    tick_playback(live, settings)
    assert live.receive_make_result(
        result(live_id, index),
        settings.live_make_result_timeout_seconds,
    ).applied
    tick_playback(live, settings)
    assert live.get_current().playback.kind == "reply"


def test_make_queue_finishes_without_viewers_and_duplicates_never_replay(make_live):
    live, settings, clock, sender, live_id = make_live
    live.pin_sku(live_id, "KG-LC-250")
    for index in range(3):
        start_reply(live, settings, live_id, index)
        current = live.get_current()
        reply = current.playback
        assert reply.media_source == "make"
        assert reply.video_url == "https://provider.example.invalid/reply.mp4"
        assert reply.duration_seconds == 5.25  # Never use the 10.077007s demo duration.
        assert reply.question_id == f"make-question-{index}"
        assert current.questions[index].sku == "BT-XIKE-01"
        assert sum(q.status == "answering" for q in current.questions) == 1
        assert sender.call_count == index + 1
        assert (
            live.receive_make_result(
                result(live_id, index),
                settings.live_make_result_timeout_seconds,
            ).reason
            == "duplicate"
        )
        tick_playback(live, settings)
        assert live.get_current().playback.playback_id == reply.playback_id
        clock.current = reply.started_at + timedelta(seconds=5.25, microseconds=-1)
        tick_playback(live, settings)
        assert live.get_current().questions[index].status == "answering"
        clock.current += timedelta(microseconds=1)
        tick_playback(live, settings)
        current = live.get_current()
        assert current.questions[index].status == "answered"
        assert current.playback.kind == "script"
        assert (clock.current - current.playback.started_at).total_seconds() == 4
        assert (
            live.receive_make_result(
                result(live_id, index),
                settings.live_make_result_timeout_seconds,
            ).reason
            == "duplicate"
        )
    tick_playback(live, settings)
    assert live.get_current().playback.kind == "script"
    assert sender.call_count == 3


def test_ready_while_paused_and_reply_pause_preserve_exact_position(make_live):
    live, settings, clock, sender, live_id = make_live
    tick_playback(live, settings)
    live.pause_session(live_id)
    assert live.receive_make_result(
        result(live_id),
        settings.live_make_result_timeout_seconds,
    ).applied
    clock.current += timedelta(seconds=100)
    tick_playback(live, settings)
    assert live.get_current().questions[0].status == "ready"
    assert live.get_current().playback.kind == "script"
    live.resume_session(live_id)
    tick_playback(live, settings)
    reply = live.get_current().playback
    clock.current = reply.started_at + timedelta(seconds=2)
    live.pause_session(live_id)
    before = live.get_current()
    clock.current += timedelta(seconds=100)
    tick_playback(live, settings)
    assert live.get_current() == before
    live.resume_session(live_id)
    resumed = live.get_current().playback
    assert resumed.playback_id == reply.playback_id
    assert (clock.current - resumed.started_at).total_seconds() == 2
    clock.current += timedelta(seconds=3.25)
    tick_playback(live, settings)
    assert live.get_current().questions[0].status == "answered"
    assert (clock.current - live.get_current().playback.started_at).total_seconds() == 4
    sender.assert_called_once()


@pytest.mark.parametrize("paused", [False, True])
def test_skip_make_reply_restores_script_and_next_question(paused, make_live):
    live, settings, clock, sender, live_id = make_live
    start_reply(live, settings, live_id)
    clock.current = live.get_current().playback.started_at + timedelta(seconds=1)
    if paused:
        live.pause_session(live_id)
    live.skip_question(live_id, "make-question-0")
    restored = live.get_current()
    assert restored.playback.kind == "script"
    position = (restored.playback.paused_at or clock.current) - restored.playback.started_at
    assert position == timedelta(seconds=4)
    assert (
        live.receive_make_result(
            result(live_id),
            settings.live_make_result_timeout_seconds,
        ).reason
        == "duplicate"
    )
    if paused:
        clock.current += timedelta(seconds=50)
        tick_playback(live, settings)
        sender.assert_called_once()
        live.resume_session(live_id)
    tick_playback(live, settings)
    assert live.get_current().questions[1].status == "processing"
    assert (
        live.receive_make_result(
            result(live_id),
            settings.live_make_result_timeout_seconds,
        ).reason
        == "duplicate"
    )
    assert live.get_current().questions[1].status == "processing"
    assert sender.call_count == 2


@pytest.mark.parametrize(
    "status,code",
    [
        ("skipped", "unsupported_intent"),
        ("failed", "product_not_found"),
        ("failed", "generation_failed"),
        ("failed", "generation_timeout"),
    ],
)
def test_terminal_callbacks_release_fifo_without_interrupting_script(make_live, status, code):
    live, settings, clock, sender, live_id = make_live
    tick_playback(live, settings)
    script = live.get_current().playback
    terminal = result(live_id, status=status, errorCode=code, videoUrl=None, durationSeconds=None)
    assert live.receive_make_result(
        terminal,
        settings.live_make_result_timeout_seconds,
    ).applied
    tick_playback(live, settings)
    assert live.get_current().playback == script
    assert live.get_current().questions[0].status == status
    assert live.get_current().questions[1].status == "processing"
    assert (
        live.receive_make_result(
            terminal,
            settings.live_make_result_timeout_seconds,
        ).reason
        == "duplicate"
    )
    assert live.get_current().questions[1].status == "processing"
    assert sender.call_count == 2


@pytest.mark.parametrize("state", ["processing", "paused", "skipped"])
def test_callback_deadline_releases_slot_and_late_result_cannot_reclaim(make_live, state):
    live, settings, clock, sender, live_id = make_live
    tick_playback(live, settings)
    if state == "paused":
        live.pause_session(live_id)
    if state == "skipped":
        live.skip_question(live_id, "make-question-0")
    clock.current += timedelta(seconds=30, microseconds=-1)
    tick_playback(live, settings)
    assert live.get_current().questions[0].status == ("skipped" if state == "skipped" else "processing")
    clock.current += timedelta(microseconds=1)
    tick_playback(live, settings)
    current = live.get_current()
    assert current.questions[0].status == ("skipped" if state == "skipped" else "failed")
    assert current.questions[0].error_code == "generation_timeout"
    assert current.questions[0].result_received_at is None
    with pytest.raises(AppError, match="not being processed"):
        live.receive_make_result(
            result(live_id),
            settings.live_make_result_timeout_seconds,
        )
    if state == "paused":
        assert current.questions[1].status == "queued"
        live.resume_session(live_id)
        tick_playback(live, settings)
    assert live.get_current().questions[1].status == "processing"
    assert sender.call_count == 2


def test_uncertain_webhook_is_not_retried_and_missing_result_has_finite_deadline(make_live):
    live, settings, clock, sender, live_id = make_live
    sender.side_effect = AppError(502, "live_make_delivery_unknown", "Synthetic transport failure")
    tick_playback(live, settings)
    for _ in range(3):
        tick_playback(live, settings)
    sender.assert_called_once()
    assert live.get_current().questions[0].error_code == "live_make_delivery_unknown"
    clock.current += timedelta(seconds=30)
    tick_playback(live, settings)
    assert live.get_current().questions[0].status == "failed"
    assert live.get_current().questions[0].error_code == "generation_timeout"
    assert sender.call_count == 2


def test_duration_conflict_and_end_or_stale_results_do_not_restart_playback(make_live):
    live, settings, clock, sender, live_id = make_live
    start_reply(live, settings, live_id)
    before = live.get_current()
    with pytest.raises(AppError) as conflict:
        live.receive_make_result(
            result(live_id, durationSeconds=6),
            settings.live_make_result_timeout_seconds,
        )
    assert conflict.value.code == "live_make_result_conflict"
    assert live.get_current() == before
    live.end_session(live_id)
    clock.current += timedelta(seconds=100)
    tick_playback(live, settings)
    assert live.get_current().playback is None
    assert (
        live.receive_make_result(
            result(live_id),
            settings.live_make_result_timeout_seconds,
        ).reason
        == "session_ended"
    )
    new = live.create_session(LiveSessionCreate(title="Next", scheduled_skus=["BT-XIKE-01"]))
    assert (
        live.receive_make_result(
            result(live_id),
            settings.live_make_result_timeout_seconds,
        ).reason
        == "stale_session"
    )
    assert live.get_current().live_id == new.live_id
    sender.assert_called_once()


@pytest.mark.parametrize("value", [0, -1, 1801, float("inf"), float("nan")])
def test_result_deadline_setting_must_be_finite_and_bounded(value):
    with pytest.raises(ValidationError):
        Settings(_env_file=None, LIVE_MAKE_RESULT_TIMEOUT_SECONDS=value)


def test_blocked_runtime_webhook_does_not_block_sse_event_loop(make_live):
    live, settings, clock, sender, live_id = make_live
    started = threading.Event()
    release = threading.Event()

    def blocked_send(*args):
        started.set()
        assert release.wait(3), "Test watchdog released blocked fake webhook"

    sender.side_effect = blocked_send

    async def check():
        task = asyncio.create_task(run_playback(live, settings))
        # A watchdog makes an accidental event-loop block fail instead of hanging.
        watchdog = threading.Timer(2, release.set)
        watchdog.start()
        try:
            deadline = time.monotonic() + 1
            while not started.is_set() and time.monotonic() < deadline:
                await asyncio.sleep(0.001)
            assert started.is_set() and not release.is_set()

            async def receive():
                return {"type": "http.request", "body": b""}

            request = Request(
                {
                    "type": "http",
                    "method": "GET",
                    "path": "/api/live/events",
                    "headers": [],
                    "app": SimpleNamespace(state=SimpleNamespace(live=live)),
                },
                receive,
            )
            response = await live_events(request)
            payload = await asyncio.wait_for(anext(response.body_iterator), timeout=0.5)
            assert "event: state" in payload and live_id in payload
            assert not release.is_set(), "Webhook I/O blocked the SSE loop until the watchdog"
            await response.body_iterator.aclose()
        finally:
            release.set()
            watchdog.cancel()
            task.cancel()
            await asyncio.gather(task, return_exceptions=True)

    asyncio.run(check())


@pytest.mark.parametrize("outcome", ["ready", "timeout"])
def test_playback_and_deadlines_advance_while_webhook_ack_is_blocked(make_live, outcome):
    live, settings, clock, sender, live_id = make_live
    started = threading.Event()
    release = threading.Event()

    def blocked_send(*args):
        started.set()
        assert release.wait(3)

    sender.side_effect = blocked_send

    async def wait_for(predicate):
        deadline = time.monotonic() + 1
        while time.monotonic() < deadline:
            if predicate():
                return
            await asyncio.sleep(0.005)
        pytest.fail("Runtime waited for webhook acknowledgement instead of advancing state")

    async def check():
        task = asyncio.create_task(run_playback(live, settings))
        watchdog = threading.Timer(2, release.set)
        watchdog.start()
        try:
            await wait_for(started.is_set)
            if outcome == "ready":
                live.receive_make_result(
                    result(live_id),
                    settings.live_make_result_timeout_seconds,
                )
                await wait_for(lambda: live.get_current().playback.kind == "reply")
                clock.current = live.get_current().playback.started_at + timedelta(seconds=5.25)
                await wait_for(lambda: live.get_current().questions[0].status == "answered")
                assert live.get_current().playback.kind == "script"
            else:
                clock.current += timedelta(seconds=30)
                await wait_for(lambda: live.get_current().questions[0].status == "failed")
                assert live.get_current().questions[0].error_code == "generation_timeout"
            assert not release.is_set()
            sender.assert_called_once()
        finally:
            release.set()
            watchdog.cancel()
            task.cancel()
            await asyncio.gather(task, return_exceptions=True)

    asyncio.run(check())


def test_make_lifespan_runs_authenticated_callbacks_to_completion_without_viewers(settings, monkeypatch):
    settings.live_make_enabled = True
    settings.live_make_callback_token = SecretStr("synthetic-callback-token-" + "x" * 32)
    sender = MagicMock(return_value=202)
    monkeypatch.setattr("app.modules.live.dispatcher.send_make_question", sender)
    with TestClient(create_app(settings)) as client:
        live = client.app.state.live
        session = live.create_session(LiveSessionCreate(title="Lifecycle", scheduled_skus=["BT-XIKE-01"]))
        live.start_session(session.live_id)
        for index in range(3):
            client.post(
                f"/api/live/{session.live_id}/questions",
                json={
                    "questionId": f"make-question-{index}",
                    "sessionId": "make-viewer-001",
                    "text": "Fake provider",
                },
            ).raise_for_status()
        for index, status in enumerate(["failed", "skipped", "ready"]):
            body = result(
                session.live_id,
                index,
                **(
                    {
                        "status": status,
                        "videoUrl": None,
                        "durationSeconds": None,
                        "errorCode": "generation_failed",
                    }
                    if status != "ready"
                    else {"durationSeconds": 0.15}
                ),
            ).model_dump(mode="json", by_alias=True)
            client.post(
                "/api/live/make-result",
                json=body,
                headers={
                    "X-Live-Make-Token": settings.live_make_callback_token.get_secret_value(),
                },
            ).raise_for_status()
        deadline = time.monotonic() + 8  # Shared 5s preparation + 0.15s media + tick margin.
        observed_reply = False
        while time.monotonic() < deadline:
            current = client.get("/api/live/current").json()["session"]
            if current["playback"]["kind"] == "reply":
                observed_reply = True
                assert current["playback"]["mediaSource"] == "make"
                assert current["playback"]["durationSeconds"] == 0.15
            if current["questions"][2]["status"] == "answered":
                break
            time.sleep(0.01)
        else:
            pytest.fail("Make runtime did not complete the fake-provider reply")
        assert observed_reply
        assert current["playback"]["kind"] == "script"
        assert [q["status"] for q in current["questions"]] == ["failed", "skipped", "answered"]
        assert sender.call_count == 3
