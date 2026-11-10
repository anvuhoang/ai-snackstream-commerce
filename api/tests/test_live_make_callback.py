from concurrent.futures import ThreadPoolExecutor

import pytest
from pydantic import SecretStr

from app.modules.live.schemas import LiveMakeResultIn, LiveQuestionIn, LiveSessionCreate

TEST_TOKEN = "callback-test-token-" + "x" * 32
CALLBACK_PATH = "/api/live/make-result"
HEADERS = {"X-Live-Make-Token": TEST_TOKEN}


@pytest.fixture
def callback_live(client):
    client.app.state.settings.live_make_callback_token = SecretStr(TEST_TOKEN)
    service = client.app.state.live
    live = service.create_session(
        LiveSessionCreate(title="Callback test", scheduled_skus=["BT-XIKE-01", "KG-LC-250"])
    )
    service.start_session(live.live_id)
    for index in range(2):
        service.submit_question(
            live.live_id,
            LiveQuestionIn(
                question_id=f"callback-question-{index}",
                session_id="callback-viewer-001",
                text=f"Câu hỏi {index}",
            ),
        )
    service.claim_next_question(live.live_id)
    payload = {
        "liveId": live.live_id,
        "questionId": "callback-question-0",
        "sku": "BT-XIKE-01",
        "status": "ready",
        "replyText": "Thông tin này chưa được xác minh.",
        "videoUrl": "https://example.invalid/video.mp4",
        "providerTalkId": "talk-test-001",
    }
    return client, service, payload


@pytest.mark.parametrize("headers", [{}, {"X-Live-Make-Token": "wrong-token"}])
def test_callback_requires_token(callback_live, headers):
    client, service, payload = callback_live
    response = client.post(CALLBACK_PATH, json=payload, headers=headers)
    assert response.status_code == 403
    assert response.json()["error"]["code"] == "live_make_callback_forbidden"
    assert service.get_current().questions[0].status == "processing"


def test_missing_server_token_disables_callback(callback_live):
    client, service, payload = callback_live
    client.app.state.settings.live_make_callback_token = SecretStr("")
    response = client.post(CALLBACK_PATH, json=payload, headers=HEADERS)
    assert response.status_code == 503
    assert service.get_current().questions[0].result_received_at is None


def test_ready_result_keeps_question_context_and_playback(callback_live):
    client, service, payload = callback_live
    service.pin_sku(payload["liveId"], "KG-LC-250")
    before = service.get_current().playback
    response = client.post(CALLBACK_PATH, json=payload, headers=HEADERS)

    assert response.status_code == 200
    assert response.json() == {"received": True, "applied": True, "reason": "accepted"}
    current = service.get_current()
    question = current.questions[0]
    assert question.status == "ready"
    assert question.sku == "BT-XIKE-01"
    assert question.reply_text == payload["replyText"]
    assert str(question.video_url) == payload["videoUrl"]
    assert question.provider_talk_id == "talk-test-001"
    assert question.result_received_at is not None
    assert current.playback == before
    assert service.claim_next_question(payload["liveId"]) is None


def test_duplicate_is_stable_and_conflicting_result_is_rejected(callback_live):
    client, service, payload = callback_live
    client.post(CALLBACK_PATH, json=payload, headers=HEADERS).raise_for_status()
    first = service.get_current().questions[0]
    repeated = client.post(CALLBACK_PATH, json=payload, headers=HEADERS)
    assert repeated.status_code == 200
    assert repeated.json()["reason"] == "duplicate"
    assert service.get_current().questions[0] == first

    changed = {**payload, "replyText": "Nội dung khác"}
    assert client.post(CALLBACK_PATH, json=changed, headers=HEADERS).status_code == 409
    assert service.get_current().questions[0] == first


@pytest.mark.parametrize(
    "changes,expected_status",
    [
        ({"sku": "KG-LC-250"}, 409),
        ({"questionId": "callback-question-1"}, 409),
        ({"questionId": "unknown-question-001"}, 404),
        ({"videoUrl": "http://example.invalid/video.mp4"}, 422),
    ],
)
def test_invalid_result_does_not_change_active_question(callback_live, changes, expected_status):
    client, service, payload = callback_live
    response = client.post(CALLBACK_PATH, json={**payload, **changes}, headers=HEADERS)
    assert response.status_code == expected_status
    assert service.get_current().questions[0].status == "processing"
    assert service.get_current().questions[0].result_received_at is None


def test_ended_session_ignores_late_result(callback_live):
    client, service, payload = callback_live
    service.end_session(payload["liveId"])
    response = client.post(CALLBACK_PATH, json=payload, headers=HEADERS)
    assert response.status_code == 200
    assert response.json()["reason"] == "session_ended"
    assert not response.json()["applied"]
    assert service.get_current().questions[0].video_url is None


def test_new_session_ignores_previous_session_result(callback_live):
    client, service, payload = callback_live
    service.end_session(payload["liveId"])
    new_live = service.create_session(
        LiveSessionCreate(title="New live", scheduled_skus=["BT-XIKE-01"])
    )
    response = client.post(CALLBACK_PATH, json=payload, headers=HEADERS)
    assert response.status_code == 200
    assert response.json()["reason"] == "stale_session"
    assert service.get_current().live_id == new_live.live_id
    assert service.get_current().questions == []


def test_skipped_result_releases_slot_but_duplicate_cannot_release_next_slot(callback_live):
    client, service, payload = callback_live
    service.skip_question(payload["liveId"], payload["questionId"])
    response = client.post(CALLBACK_PATH, json=payload, headers=HEADERS)
    assert response.status_code == 200
    assert response.json()["reason"] == "question_skipped"
    assert not response.json()["applied"]
    assert service.get_current().questions[0].video_url is None

    assert service.claim_next_question(payload["liveId"]).question_id == "callback-question-1"
    assert client.post(CALLBACK_PATH, json=payload, headers=HEADERS).json()["reason"] == "duplicate"
    assert service.claim_next_question(payload["liveId"]) is None


def test_skipping_ready_question_releases_slot(callback_live):
    client, service, payload = callback_live
    client.post(CALLBACK_PATH, json=payload, headers=HEADERS).raise_for_status()
    assert service.skip_question(payload["liveId"], payload["questionId"]).status == "skipped"
    assert service.claim_next_question(payload["liveId"]).question_id == "callback-question-1"
    client.post(CALLBACK_PATH, json=payload, headers=HEADERS).raise_for_status()
    assert service.claim_next_question(payload["liveId"]) is None


@pytest.mark.parametrize("status", ["failed", "skipped"])
def test_non_video_result_releases_slot(callback_live, status):
    client, service, payload = callback_live
    payload.update(status=status, videoUrl=None, replyText=None, errorCode="generation_failed")
    response = client.post(CALLBACK_PATH, json=payload, headers=HEADERS)
    assert response.status_code == 200
    assert response.json()["applied"]
    assert service.get_current().questions[0].status == status
    assert service.claim_next_question(payload["liveId"]).question_id == "callback-question-1"


def test_paused_session_stores_ready_result_without_resuming_video(callback_live):
    client, service, payload = callback_live
    before = service.pause_session(payload["liveId"])
    client.post(CALLBACK_PATH, json=payload, headers=HEADERS).raise_for_status()
    current = service.get_current()
    assert current.status == "paused"
    assert current.playback == before.playback
    assert current.questions[0].status == "ready"


def test_concurrent_results_are_applied_once(callback_live):
    _, service, payload = callback_live
    result = LiveMakeResultIn.model_validate(payload)
    with ThreadPoolExecutor(max_workers=8) as pool:
        responses = list(pool.map(lambda _: service.receive_make_result(result), range(8)))
    assert sum(response.applied for response in responses) == 1
    assert sum(response.reason == "duplicate" for response in responses) == 7
