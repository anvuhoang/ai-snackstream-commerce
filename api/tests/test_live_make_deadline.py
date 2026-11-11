from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime, timedelta
from threading import Barrier
from unittest.mock import MagicMock

import pytest
from pydantic import SecretStr

from app.modules.live import service as service_module
from app.modules.live.dispatcher import dispatch_next_question
from app.modules.live.runtime import tick_playback
from app.modules.live.schemas import LiveQuestionIn, LiveSessionCreate

CALLBACK_PATH = "/api/live/make-result"
TOKEN = "deadline-test-token-" + "x" * 32
HEADERS = {"X-Live-Make-Token": TOKEN}


@pytest.fixture
def deadline_live(client, monkeypatch):
    # The shared fixture starts with both modes off: no lifespan ticks run, so
    # each HTTP case can test callback admission before any expiry tick.
    class Clock(datetime):
        current = datetime(2026, 11, 11, tzinfo=UTC)

        @classmethod
        def now(cls, tz=None):
            return cls.current if tz is not None else cls.current.replace(tzinfo=None)

    monkeypatch.setattr(service_module, "datetime", Clock)
    settings = client.app.state.settings
    settings.live_make_enabled = True
    settings.live_make_result_timeout_seconds = 180
    settings.live_make_callback_token = SecretStr(TOKEN)
    sender = MagicMock(return_value=202)
    monkeypatch.setattr("app.modules.live.dispatcher.send_make_question", sender)
    live = client.app.state.live
    session = live.create_session(LiveSessionCreate(
        title="HTTP callback deadline", scheduled_skus=["BT-XIKE-01", "KG-LC-250"],
    ))
    live.start_session(session.live_id)
    for index in range(2):
        live.submit_question(session.live_id, LiveQuestionIn(
            question_id=f"deadline-question-{index}",
            session_id="deadline-viewer-001", text=f"Question {index}",
        ))
    # Queue waiting time is not part of the processing deadline.
    Clock.current += timedelta(seconds=20)
    dispatch_next_question(session.live_id, live, settings)
    claimed_at = live.get_current().questions[0].processing_started_at
    assert claimed_at == Clock.current
    payload = {
        "liveId": session.live_id,
        "questionId": "deadline-question-0",
        "sku": "BT-XIKE-01",
        "status": "ready",
        "videoUrl": "https://provider.example.invalid/deadline.mp4",
        "replyText": "Synthetic provider result",
        "durationSeconds": 5.25,
    }
    return client, live, settings, Clock, claimed_at, payload, sender


def post(client, payload):
    return client.post(CALLBACK_PATH, headers=HEADERS, json=payload)


def assert_expired(client, live):
    current = client.get("/api/live/current").json()["session"]
    question = current["questions"][0]
    assert question["status"] == "failed"
    assert question["errorCode"] == "generation_timeout"
    assert question["resultReceivedAt"] is None
    assert question["videoUrl"] is None
    assert current["playback"]["kind"] == "script"
    assert live.get_current().questions[1].status == "queued"


@pytest.mark.parametrize("timeout", [180, 7.5])
@pytest.mark.parametrize("offset_us", [-1, 0, 1, 1_000_000])
@pytest.mark.parametrize("paused", [False, True])
def test_http_ready_boundary_without_expiry_tick(deadline_live, timeout, offset_us, paused):
    client, live, settings, clock, claimed, payload, sender = deadline_live
    settings.live_make_result_timeout_seconds = timeout
    if paused:
        live.pause_session(payload["liveId"])
    clock.current = claimed + timedelta(seconds=timeout, microseconds=offset_us)
    response = post(client, payload)
    if offset_us < 0:
        assert response.status_code == 200
        assert response.json()["reason"] == "accepted"
        question = live.get_current().questions[0]
        assert question.status == "ready"
        assert question.result_received_at == clock.current
        assert question.processing_started_at == claimed
    else:
        assert response.status_code == 409
        assert response.json()["error"]["code"] == "live_question_not_active"
        assert_expired(client, live)
        # Expiry and rejection released the old slot under the same lock.
        if paused:
            live.resume_session(payload["liveId"])
        next_question = live.claim_next_question(payload["liveId"])
        assert next_question.question_id == "deadline-question-1"
        assert next_question.processing_started_at == clock.current
    sender.assert_called_once()


def test_http_late_ready_after_tick_cannot_modify_next_active_question(deadline_live):
    client, live, settings, clock, claimed, payload, sender = deadline_live
    clock.current = claimed + timedelta(seconds=181)
    tick_playback(live, settings)
    before = live.get_current()
    assert before.questions[0].status == "failed"
    assert before.questions[1].status == "processing"
    response = post(client, payload)
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "live_question_not_active"
    assert live.get_current() == before
    assert live.claim_next_question(payload["liveId"]) is None
    assert sender.call_count == 2


@pytest.mark.parametrize("offset_us", [-1, 0, 1_000_000])
def test_http_callback_races_runtime_expiry_under_one_lock(deadline_live, offset_us):
    client, live, settings, clock, claimed, payload, sender = deadline_live
    clock.current = claimed + timedelta(seconds=180, microseconds=offset_us)
    # Start multiple expiry attempts together with actual HTTP callback handling.
    # All operations sample the same fake clock; no timing-dependent accepted set.
    barrier = Barrier(5)

    def callback():
        barrier.wait(timeout=5)
        return post(client, payload)

    def expiry():
        barrier.wait(timeout=5)
        return live.expire_make_question(payload["liveId"], settings.live_make_result_timeout_seconds)

    with ThreadPoolExecutor(max_workers=5) as pool:
        callback_future = pool.submit(callback)
        expiry_futures = [pool.submit(expiry) for _ in range(4)]
        response = callback_future.result(timeout=5)
        expiries = [future.result(timeout=5) for future in expiry_futures]
    assert response.status_code == (200 if offset_us < 0 else 409)
    if offset_us < 0:
        assert response.json()["reason"] == "accepted"
        assert live.get_current().questions[0].status == "ready"
        assert not any(expiries)
    else:
        assert_expired(client, live)
        assert sum(expiries) <= 1  # Callback may perform the single expiry itself.
        assert live.claim_next_question(payload["liveId"]).question_id == "deadline-question-1"
    sender.assert_called_once()


@pytest.mark.parametrize("phase", ["ready", "answering", "answered", "skipped"])
def test_http_accepted_duplicate_after_deadline_preserves_playback_and_slot(deadline_live, phase):
    client, live, settings, clock, claimed, payload, sender = deadline_live
    clock.current = claimed + timedelta(seconds=180, microseconds=-1)
    assert post(client, payload).json()["reason"] == "accepted"
    if phase != "ready":
        tick_playback(live, settings)
        assert live.get_current().questions[0].status == "answering"
        if phase == "answered":
            clock.current += timedelta(seconds=5.25)
            tick_playback(live, settings)
        elif phase == "skipped":
            live.skip_question(payload["liveId"], payload["questionId"])
        if phase in ("answered", "skipped"):
            tick_playback(live, settings)
            assert live.get_current().questions[1].status == "processing"
    clock.current = max(clock.current, claimed + timedelta(seconds=181))
    before = live.get_current()
    response = post(client, payload)
    assert response.status_code == 200
    assert response.json() == {"received": True, "applied": False, "reason": "duplicate"}
    assert live.get_current() == before
    assert not live.expire_make_question(payload["liveId"], settings.live_make_result_timeout_seconds)
    changed = post(client, {**payload, "durationSeconds": 6})
    assert changed.status_code == 409
    assert changed.json()["error"]["code"] == "live_make_result_conflict"
    assert live.get_current() == before


@pytest.mark.parametrize("correction_us", [-1, 0, 1_000_000])
def test_http_metadata_422_then_correction_uses_original_deadline(deadline_live, correction_us):
    client, live, settings, clock, claimed, payload, sender = deadline_live
    clock.current = claimed + timedelta(seconds=179)
    before = live.get_current()
    missing = {key: value for key, value in payload.items() if key != "durationSeconds"}
    for invalid in [missing, {**payload, "durationSeconds": "5.25"}]:
        assert post(client, invalid).status_code == 422
        assert live.get_current() == before
    clock.current = claimed + timedelta(seconds=180, microseconds=correction_us)
    corrected = post(client, payload)
    assert corrected.status_code == (200 if correction_us < 0 else 409)
    assert live.get_current().questions[0].processing_started_at == claimed
    if correction_us >= 0:
        assert_expired(client, live)
        tick_playback(live, settings)
        next_active = live.get_current()
        assert next_active.questions[1].status == "processing"
        assert post(client, payload).status_code == 409
        assert live.get_current() == next_active


@pytest.mark.parametrize("status", ["failed", "skipped"])
def test_http_uncached_terminal_result_at_deadline_is_also_rejected(deadline_live, status):
    client, live, settings, clock, claimed, payload, sender = deadline_live
    clock.current = claimed + timedelta(seconds=180)
    terminal = {**payload, "status": status, "videoUrl": None,
                "durationSeconds": None, "errorCode": "generation_failed"}
    assert post(client, terminal).status_code == 409
    assert_expired(client, live)


def test_http_skipped_inflight_callback_at_deadline_does_not_restore_question(deadline_live):
    client, live, settings, clock, claimed, payload, sender = deadline_live
    live.skip_question(payload["liveId"], payload["questionId"])
    clock.current = claimed + timedelta(seconds=180)
    assert post(client, payload).status_code == 409
    current = live.get_current()
    assert current.questions[0].status == "skipped"
    assert current.questions[0].error_code == "generation_timeout"
    assert current.questions[0].result_received_at is None
    assert live.claim_next_question(payload["liveId"]).question_id == "deadline-question-1"


@pytest.mark.parametrize("case,expected", [("sku", 409), ("token", 403), ("metadata", 422),
                                         ("ended", 200), ("stale", 200)])
def test_http_existing_guards_are_preserved_past_deadline(deadline_live, case, expected):
    client, live, settings, clock, claimed, payload, sender = deadline_live
    clock.current = claimed + timedelta(seconds=181)
    headers = HEADERS
    if case == "sku":
        payload = {**payload, "sku": "KG-LC-250"}
    elif case == "token":
        headers = {"X-Live-Make-Token": "wrong"}
    elif case == "metadata":
        payload = {**payload, "durationSeconds": None}
    else:
        live.end_session(payload["liveId"])
        if case == "stale":
            live.create_session(LiveSessionCreate(title="New", scheduled_skus=["BT-XIKE-01"]))
    before = live.get_current()
    response = client.post(CALLBACK_PATH, headers=headers, json=payload)
    assert response.status_code == expected
    if case == "sku":
        assert response.json()["error"]["code"] == "live_make_sku_mismatch"
    if case in ("ended", "stale"):
        assert response.json()["reason"] == ("session_ended" if case == "ended" else "stale_session")
        assert not response.json()["applied"]
    assert live.get_current() == before
