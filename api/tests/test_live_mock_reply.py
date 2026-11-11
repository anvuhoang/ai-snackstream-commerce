from concurrent.futures import ThreadPoolExecutor

import pytest
from pydantic import ValidationError

from app.modules.live.schemas import LiveMakeResultIn, LiveQuestionIn, LiveSessionCreate
from app.modules.live.service import LiveService


@pytest.fixture
def mock_live():
    service = LiveService()
    session = service.create_session(
        LiveSessionCreate(title="Mock reply test", scheduled_skus=["BT-XIKE-01", "KG-LC-250"])
    )
    service.start_session(session.live_id)
    for index in range(2):
        service.submit_question(
            session.live_id,
            LiveQuestionIn(
                question_id=f"mock-question-{index}",
                session_id="mock-viewer-001",
                text=f"Question {index}",
            ),
        )
    service.claim_next_question(session.live_id)
    return service, session.live_id


def test_mock_result_has_explicit_provenance_and_keeps_script_and_sku(mock_live):
    service, live_id = mock_live
    before = service.get_current().playback
    service.pin_sku(live_id, "KG-LC-250")
    assert service.complete_mock_question(live_id, "mock-question-0", 10.077007)
    current = service.get_current()
    question = current.questions[0]
    assert question.status == "ready"
    assert question.sku == "BT-XIKE-01"
    assert question.media_source == "prerecorded"
    assert question.video_url == "/live-demo/avatar.mp4"
    assert question.video_duration_seconds == 10.077007
    assert question.provider_talk_id is None
    assert question.result_received_at is not None
    assert "không phải câu trả lời" in question.reply_text
    assert current.playback == before
    assert service.claim_next_question(live_id) is None


def test_concurrent_completion_is_applied_once(mock_live):
    service, live_id = mock_live
    with ThreadPoolExecutor(max_workers=8) as pool:
        applied = list(pool.map(
            lambda _: service.complete_mock_question(live_id, "mock-question-0", 10.077007),
            range(8),
        ))
    assert sum(applied) == 1
    before = service.get_current()
    assert not service.complete_mock_question(live_id, "mock-question-0", 10.077007)
    assert service.get_current() == before


def test_skipped_question_is_not_restored_and_releases_slot(mock_live):
    service, live_id = mock_live
    service.skip_question(live_id, "mock-question-0")
    assert not service.complete_mock_question(live_id, "mock-question-0", 10.077007)
    assert service.get_current().questions[0].video_url is None
    assert service.claim_next_question(live_id).question_id == "mock-question-1"


def test_pause_allows_preparation_without_resuming_video(mock_live):
    service, live_id = mock_live
    paused = service.pause_session(live_id)
    assert service.complete_mock_question(live_id, "mock-question-0", 10.077007)
    current = service.get_current()
    assert current.status == "paused"
    assert current.playback == paused.playback


def test_stale_or_inactive_completion_does_not_change_state(mock_live):
    service, live_id = mock_live
    before = service.get_current()
    assert not service.complete_mock_question("old-live-id", "mock-question-0", 10.077007)
    assert not service.complete_mock_question(live_id, "mock-question-1", 10.077007)
    assert service.get_current() == before
    service.end_session(live_id)
    ended = service.get_current()
    assert not service.complete_mock_question(live_id, "mock-question-0", 10.077007)
    assert service.get_current() == ended


@pytest.mark.parametrize("duration", [0, -1, 301, float("inf"), float("nan")])
def test_invalid_mock_duration_does_not_partially_update_question(mock_live, duration):
    service, live_id = mock_live
    before = service.get_current()
    with pytest.raises(ValidationError):
        service.complete_mock_question(live_id, "mock-question-0", duration)
    assert service.get_current() == before


def test_make_callback_still_rejects_relative_video_url():
    with pytest.raises(ValidationError):
        LiveMakeResultIn.model_validate({
            "liveId": "live-test-001",
            "questionId": "question-test-001",
            "sku": "BT-XIKE-01",
            "status": "ready",
            "replyText": "Test",
            "videoUrl": "/live-demo/avatar.mp4",
            "durationSeconds": 10.077007,
        })
