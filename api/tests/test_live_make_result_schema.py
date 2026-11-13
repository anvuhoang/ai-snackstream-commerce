import pytest
from pydantic import ValidationError

from app.modules.live.schemas import LiveMakeResultIn


def ready_payload():
    return {
        "liveId": "live-test-001",
        "questionId": "question-test-001",
        "sku": "bt-xike-01",
        "status": "ready",
        "replyText": "Thông tin này chưa được xác minh.",
        "videoUrl": "https://example.invalid/avatar.mp4",
        "durationSeconds": 12.5,
        "providerTalkId": "talk-test-001",
    }


def test_ready_result_accepts_camel_case_and_normalizes_sku():
    result = LiveMakeResultIn.model_validate(ready_payload())
    assert result.live_id == "live-test-001"
    assert result.question_id == "question-test-001"
    assert result.sku == "BT-XIKE-01"
    assert result.reply_text == "Thông tin này chưa được xác minh."
    assert result.duration_seconds == 12.5


@pytest.mark.parametrize(
    "changes",
    [
        {"videoUrl": None},
        {"videoUrl": "http://example.invalid/avatar.mp4"},
        {"videoUrl": "https://user:password@example.invalid/avatar.mp4"},
        {"replyText": "   "},
        {"errorCode": "generation_failed"},
        {"status": "done"},
        {"replyText": "x" * 1501},
        {"liveId": "short"},
        {"durationSeconds": None},
        {"durationSeconds": 0},
        {"durationSeconds": -1},
        {"durationSeconds": 300.01},
        {"durationSeconds": float("inf")},
        {"durationSeconds": float("nan")},
        {"durationSeconds": "12.5"},
        {"durationSeconds": True},
    ],
)
def test_invalid_ready_results_are_rejected(changes):
    payload = ready_payload()
    payload.update(changes)
    with pytest.raises(ValidationError):
        LiveMakeResultIn.model_validate(payload)


@pytest.mark.parametrize("status", ["failed", "skipped"])
def test_non_video_result_requires_a_reason(status):
    payload = ready_payload()
    payload.update(status=status, videoUrl=None, durationSeconds=None, errorCode="unsupported_intent")
    assert LiveMakeResultIn.model_validate(payload).status == status

    payload.pop("errorCode")
    with pytest.raises(ValidationError):
        LiveMakeResultIn.model_validate(payload)


def test_failed_result_rejects_video_url():
    payload = ready_payload()
    payload.update(status="failed", errorCode="generation_failed")
    with pytest.raises(ValidationError):
        LiveMakeResultIn.model_validate(payload)


@pytest.mark.parametrize("duration", [0.001, 1, 300])
def test_measured_duration_accepts_bounded_json_numbers(duration):
    value = LiveMakeResultIn.model_validate({**ready_payload(), "durationSeconds": duration})
    assert value.duration_seconds == duration


@pytest.mark.parametrize("status", ["failed", "skipped"])
def test_terminal_result_rejects_duration_metadata(status):
    payload = {**ready_payload(), "status": status, "videoUrl": None, "errorCode": "generation_failed"}
    with pytest.raises(ValidationError):
        LiveMakeResultIn.model_validate(payload)
