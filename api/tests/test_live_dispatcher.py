from unittest.mock import MagicMock

import pytest
from pydantic import SecretStr

from app.core.errors import AppError
from app.modules.live.dispatcher import dispatch_next_question
from app.modules.live.schemas import LiveMakeResultIn, LiveSessionCreate

TEST_TOKEN = "dispatcher-test-token-" + "x" * 32


@pytest.fixture
def dispatch_live(client, monkeypatch):
    settings = client.app.state.settings
    settings.live_make_enabled = True
    settings.live_make_webhook_url = SecretStr("https://example.invalid/private-webhook")
    settings.live_make_callback_token = SecretStr(TEST_TOKEN)
    sender = MagicMock(return_value=200)
    monkeypatch.setattr("app.modules.live.dispatcher.send_make_question", sender)
    service = client.app.state.live
    live = service.create_session(
        LiveSessionCreate(title="Dispatch test", scheduled_skus=["BT-XIKE-01", "KG-LC-250"])
    )
    service.start_session(live.live_id)
    return client, service, live.live_id, sender


def submit(client, live_id, index=0):
    return client.post(
        f"/api/live/{live_id}/questions",
        json={
            "questionId": f"dispatch-question-{index}",
            "sessionId": "dispatch-viewer-001",
            "text": f"Câu hỏi {index}",
        },
    )


def callback_payload(live_id, status="ready"):
    return {
        "liveId": live_id,
        "questionId": "dispatch-question-0",
        "sku": "BT-XIKE-01",
        "status": status,
        "replyText": "Thông tin chưa được xác minh." if status == "ready" else None,
        "videoUrl": "https://example.invalid/video.mp4" if status == "ready" else None,
        "errorCode": None if status == "ready" else "generation_failed",
    }


def admin_headers(client):
    settings = client.app.state.settings
    response = client.post(
        "/api/admin/auth/login",
        json={"email": settings.bootstrap_admin_email, "password": settings.bootstrap_admin_password},
    )
    response.raise_for_status()
    return {"X-CSRF-Token": response.json()["csrf"]}


def test_guest_submission_dispatches_once_and_queues_other_questions(dispatch_live):
    client, service, live_id, sender = dispatch_live
    assert not client.cookies
    assert submit(client, live_id).status_code == 200
    assert submit(client, live_id, 1).status_code == 200
    assert submit(client, live_id).status_code == 200

    sender.assert_called_once()
    assert sender.call_args.args[0].question_id == "dispatch-question-0"
    current = service.get_current()
    assert [question.status for question in current.questions] == ["processing", "queued"]


def test_disabled_integration_keeps_question_queued(dispatch_live):
    client, service, live_id, sender = dispatch_live
    client.app.state.settings.live_make_enabled = False
    submit(client, live_id).raise_for_status()
    sender.assert_not_called()
    assert service.get_current().questions[0].status == "queued"


def test_paused_submission_dispatches_on_admin_resume(dispatch_live):
    client, service, live_id, sender = dispatch_live
    service.pause_session(live_id)
    submit(client, live_id).raise_for_status()
    sender.assert_not_called()

    response = client.post(f"/api/admin/live/{live_id}/resume", headers=admin_headers(client))
    assert response.status_code == 200
    sender.assert_called_once()
    assert service.get_current().questions[0].status == "processing"


@pytest.mark.parametrize("status", ["failed", "skipped"])
def test_non_video_callback_dispatches_next_question(dispatch_live, status):
    client, service, live_id, sender = dispatch_live
    submit(client, live_id).raise_for_status()
    submit(client, live_id, 1).raise_for_status()
    response = client.post(
        "/api/live/make-result",
        json=callback_payload(live_id, status),
        headers={"X-Live-Make-Token": TEST_TOKEN},
    )
    assert response.status_code == 200
    assert sender.call_count == 2
    assert [q.status for q in service.get_current().questions] == [status, "processing"]


def test_ready_result_waits_until_admin_skips_it(dispatch_live):
    client, service, live_id, sender = dispatch_live
    submit(client, live_id).raise_for_status()
    submit(client, live_id, 1).raise_for_status()
    client.post(
        "/api/live/make-result",
        json=callback_payload(live_id),
        headers={"X-Live-Make-Token": TEST_TOKEN},
    ).raise_for_status()
    sender.assert_called_once()

    client.post(
        f"/api/admin/live/{live_id}/questions/dispatch-question-0/skip",
        headers=admin_headers(client),
    ).raise_for_status()
    assert sender.call_count == 2
    assert service.get_current().questions[1].status == "processing"


def test_skipped_inflight_result_dispatches_next_but_duplicate_does_not(dispatch_live):
    client, service, live_id, sender = dispatch_live
    submit(client, live_id).raise_for_status()
    submit(client, live_id, 1).raise_for_status()
    service.skip_question(live_id, "dispatch-question-0")
    for _ in range(2):
        client.post(
            "/api/live/make-result",
            json=callback_payload(live_id),
            headers={"X-Live-Make-Token": TEST_TOKEN},
        ).raise_for_status()
    assert sender.call_count == 2
    assert service.get_current().questions[1].status == "processing"


@pytest.mark.parametrize("code", ["live_make_http_error", "live_make_delivery_unknown"])
def test_uncertain_delivery_keeps_slot_and_does_not_retry(dispatch_live, code):
    client, service, live_id, sender = dispatch_live
    sender.side_effect = AppError(502, code, "Delivery unconfirmed.")
    submit(client, live_id).raise_for_status()
    submit(client, live_id, 1).raise_for_status()
    sender.assert_called_once()
    first = service.get_current().questions[0]
    assert first.status == "processing"
    assert first.error_code == code
    assert service.get_current().questions[1].status == "queued"


def test_configuration_error_fails_question_without_holding_slot(dispatch_live):
    client, service, live_id, sender = dispatch_live
    sender.side_effect = AppError(503, "live_make_not_configured", "Invalid configuration.")
    submit(client, live_id).raise_for_status()
    first = service.get_current().questions[0]
    assert first.status == "failed"
    assert first.error_code == "live_make_not_configured"
    sender.assert_called_once()


def test_late_send_error_does_not_overwrite_callback_result(dispatch_live):
    client, service, live_id, sender = dispatch_live

    def callback_then_error(question, settings):
        service.receive_make_result(LiveMakeResultIn.model_validate(callback_payload(live_id)))
        raise AppError(502, "live_make_delivery_unknown", "Delivery unconfirmed.")

    sender.side_effect = callback_then_error
    submit(client, live_id).raise_for_status()
    first = service.get_current().questions[0]
    assert first.status == "ready"
    assert first.error_code is None


def test_ended_session_is_not_reopened_by_send_error(dispatch_live):
    client, service, live_id, sender = dispatch_live

    def end_then_error(question, settings):
        service.end_session(live_id)
        raise AppError(502, "live_make_delivery_unknown", "Delivery unconfirmed.")

    sender.side_effect = end_then_error
    submit(client, live_id).raise_for_status()
    assert service.get_current().status == "ended"
    assert service.get_current().questions[0].status == "skipped"
    assert service.get_current().questions[0].error_code is None


def test_unexpected_error_is_recorded_without_leaking_details(dispatch_live, caplog):
    client, service, live_id, sender = dispatch_live
    sender.side_effect = RuntimeError("private-webhook-secret")
    submit(client, live_id).raise_for_status()
    assert service.get_current().questions[0].error_code == "live_make_delivery_unknown"
    assert "private-webhook-secret" not in caplog.text
    sender.assert_called_once()


def test_stale_background_task_does_not_touch_new_session(dispatch_live):
    client, service, live_id, sender = dispatch_live
    service.end_session(live_id)
    new_live = service.create_session(
        LiveSessionCreate(title="New session", scheduled_skus=["BT-XIKE-01"])
    )
    dispatch_next_question(live_id, service, client.app.state.settings)
    sender.assert_not_called()
    assert service.get_current().live_id == new_live.live_id


def test_invalid_question_does_not_dispatch(dispatch_live):
    client, service, live_id, sender = dispatch_live
    response = client.post(
        f"/api/live/{live_id}/questions",
        json={"questionId": "dispatch-question-0", "sessionId": "dispatch-viewer-001", "text": " "},
    )
    assert response.status_code == 422
    sender.assert_not_called()
    assert service.get_current().questions == []
