from concurrent.futures import ThreadPoolExecutor

import pytest

from app.modules.live.schemas import LiveQuestionIn, LiveSessionCreate
from app.modules.live.service import LiveService


def create_live(service):
    live = service.create_session(
        LiveSessionCreate(title="Reply start test", scheduled_skus=["BT-XIKE-01", "KG-LC-250"])
    )
    service.start_session(live.live_id)
    service.submit_question(
        live.live_id,
        LiveQuestionIn(
            question_id="reply-question-001",
            session_id="reply-viewer-001",
            text="Test reply playback",
        ),
    )
    return live.live_id


@pytest.fixture
def ready_live():
    service = LiveService()
    live_id = create_live(service)
    service.claim_next_question(live_id)
    assert service.complete_mock_question(live_id, "reply-question-001", 10.077007)
    return service, live_id


def test_start_selects_reply_and_preserves_original_question_sku(ready_live):
    service, live_id = ready_live
    script = service.get_current().playback
    service.pin_sku(live_id, "KG-LC-250")
    assert service.start_ready_reply(live_id)
    current = service.get_current()
    assert current.status == "playing"
    assert current.playback.kind == "reply"
    assert current.playback.media_source == "prerecorded"
    assert current.playback.question_id == "reply-question-001"
    assert current.playback.duration_seconds == 10.077007
    assert current.playback.video_url == "/live-demo/avatar.mp4"
    assert current.playback.playback_id != script.playback_id
    assert current.questions[0].status == "answering"
    assert current.questions[0].sku == "BT-XIKE-01"
    assert current.pinned_sku == "KG-LC-250"
    assert service.claim_next_question(live_id) is None


def test_concurrent_starts_apply_only_once(ready_live):
    service, live_id = ready_live
    with ThreadPoolExecutor(max_workers=8) as pool:
        results = list(pool.map(lambda _: service.start_ready_reply(live_id), range(8)))
    assert sum(results) == 1
    before = service.get_current()
    assert not service.start_ready_reply(live_id)
    assert service.get_current() == before


def test_paused_live_does_not_start_until_resumed(ready_live):
    service, live_id = ready_live
    service.pause_session(live_id)
    before = service.get_current()
    assert not service.start_ready_reply(live_id)
    assert service.get_current() == before
    service.resume_session(live_id)
    assert service.start_ready_reply(live_id)


@pytest.mark.parametrize("claimed", [False, True])
def test_question_without_ready_video_does_not_interrupt_script(claimed):
    service = LiveService()
    live_id = create_live(service)
    if claimed:
        service.claim_next_question(live_id)
    before = service.get_current()
    assert not service.start_ready_reply(live_id)
    assert service.get_current() == before


def test_skipped_reply_is_not_started(ready_live):
    service, live_id = ready_live
    service.skip_question(live_id, "reply-question-001")
    before = service.get_current()
    assert not service.start_ready_reply(live_id)
    assert service.get_current() == before


def test_missing_or_stale_session_is_ignored(ready_live):
    assert not LiveService().start_ready_reply("old-live-id")
    service, live_id = ready_live
    before = service.get_current()
    assert not service.start_ready_reply("old-live-id")
    assert service.get_current() == before


def test_ending_reply_clears_playback_and_allows_new_live(ready_live):
    service, live_id = ready_live
    assert service.start_ready_reply(live_id)
    ended = service.end_session(live_id)
    assert ended.playback is None
    assert ended.questions[0].status == "skipped"
    assert not service.start_ready_reply(live_id)
    next_id = create_live(service)
    service.claim_next_question(next_id)
    service.complete_mock_question(next_id, "reply-question-001", 10.077007)
    assert not service.start_ready_reply(live_id)
    assert service.start_ready_reply(next_id)
