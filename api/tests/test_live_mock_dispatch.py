from unittest.mock import MagicMock

import pytest

from app.modules.live.dispatcher import dispatch_next_question
from app.modules.live.schemas import LiveSessionCreate


@pytest.fixture
def mock_dispatch_live(client, monkeypatch):
    settings = client.app.state.settings
    settings.live_make_enabled = False
    settings.live_mock_enabled = True
    settings.live_mock_video_duration_seconds = 10.077007
    sender = MagicMock(side_effect=AssertionError("Mock mode must not call Make"))
    monkeypatch.setattr("app.modules.live.dispatcher.send_make_question", sender)
    service = client.app.state.live
    live = service.create_session(
        LiveSessionCreate(title="Mock dispatch test", scheduled_skus=["BT-XIKE-01"])
    )
    service.start_session(live.live_id)
    return client, service, live.live_id, sender


def submit(client, live_id, index=0):
    return client.post(
        f"/api/live/{live_id}/questions",
        json={
            "questionId": f"mock-dispatch-question-{index}",
            "sessionId": "mock-dispatch-viewer-001",
            "text": f"Question {index}",
        },
    )


def admin_headers(client):
    settings = client.app.state.settings
    response = client.post(
        "/api/admin/auth/login",
        json={"email": settings.bootstrap_admin_email, "password": settings.bootstrap_admin_password},
    )
    response.raise_for_status()
    return {"X-CSRF-Token": response.json()["csrf"]}


def test_submission_prepares_mock_reply_without_calling_make(mock_dispatch_live):
    client, service, live_id, sender = mock_dispatch_live
    submit(client, live_id).raise_for_status()
    response = client.get("/api/live/current")
    response.raise_for_status()
    question = response.json()["session"]["questions"][0]
    assert question["status"] == "ready"
    assert question["mediaSource"] == "prerecorded"
    assert question["videoDurationSeconds"] == 10.077007
    assert question["videoUrl"] == "/live-demo/avatar.mp4"
    assert question["providerTalkId"] is None
    assert service.get_current().playback.kind == "script"
    sender.assert_not_called()


def test_duplicate_does_not_reprepare_and_next_question_waits(mock_dispatch_live):
    client, service, live_id, sender = mock_dispatch_live
    submit(client, live_id).raise_for_status()
    before = service.get_current().questions[0]
    submit(client, live_id).raise_for_status()
    submit(client, live_id, 1).raise_for_status()
    current = service.get_current()
    assert current.questions[0] == before
    assert [q.status for q in current.questions] == ["ready", "queued"]
    sender.assert_not_called()


def test_paused_question_is_prepared_only_after_resume(mock_dispatch_live):
    client, service, live_id, sender = mock_dispatch_live
    service.pause_session(live_id)
    submit(client, live_id).raise_for_status()
    assert service.get_current().questions[0].status == "queued"
    client.post(
        f"/api/admin/live/{live_id}/resume", headers=admin_headers(client)
    ).raise_for_status()
    assert service.get_current().questions[0].status == "ready"
    sender.assert_not_called()


def test_skipping_ready_question_prepares_next(mock_dispatch_live):
    client, service, live_id, sender = mock_dispatch_live
    submit(client, live_id).raise_for_status()
    submit(client, live_id, 1).raise_for_status()
    client.post(
        f"/api/admin/live/{live_id}/questions/mock-dispatch-question-0/skip",
        headers=admin_headers(client),
    ).raise_for_status()
    assert [q.status for q in service.get_current().questions] == ["skipped", "ready"]
    sender.assert_not_called()


def test_both_modes_disabled_leave_question_queued(mock_dispatch_live):
    client, service, live_id, sender = mock_dispatch_live
    client.app.state.settings.live_mock_enabled = False
    submit(client, live_id).raise_for_status()
    assert service.get_current().questions[0].status == "queued"
    sender.assert_not_called()


def test_stale_dispatch_does_not_change_new_session(mock_dispatch_live):
    client, service, live_id, sender = mock_dispatch_live
    service.end_session(live_id)
    new_live = service.create_session(
        LiveSessionCreate(title="Next mock live", scheduled_skus=["BT-XIKE-01"])
    )
    before = service.get_current()
    dispatch_next_question(live_id, service, client.app.state.settings)
    assert service.get_current() == before
    assert service.get_current().live_id == new_live.live_id
    sender.assert_not_called()
