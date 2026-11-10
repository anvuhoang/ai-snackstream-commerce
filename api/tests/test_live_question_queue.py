from concurrent.futures import ThreadPoolExecutor

import pytest

from app.modules.live.schemas import LiveQuestionIn, LiveSessionCreate
from app.modules.live.service import LiveService


@pytest.fixture
def queued_live():
    service = LiveService()
    live = service.create_session(
        LiveSessionCreate(title="Queue test", scheduled_skus=["BT-XIKE-01", "KG-LC-250"])
    )
    service.start_session(live.live_id)
    for index in range(3):
        service.submit_question(
            live.live_id,
            LiveQuestionIn(
                question_id=f"question-{index}",
                session_id="viewer-test-001",
                text=f"Câu hỏi {index}",
            ),
        )
    return service, live.live_id


def test_claim_is_fifo_and_keeps_original_sku(queued_live):
    service, live_id = queued_live
    service.pin_sku(live_id, "KG-LC-250")
    first = service.claim_next_question(live_id)

    assert first is not None
    assert first.question_id == "question-0"
    assert first.sku == "BT-XIKE-01"
    assert first.status == "processing"
    assert first.processing_started_at is not None
    assert service.claim_next_question(live_id) is None


def test_concurrent_claims_select_only_one_question(queued_live):
    service, live_id = queued_live
    with ThreadPoolExecutor(max_workers=8) as pool:
        results = list(pool.map(lambda _: service.claim_next_question(live_id), range(8)))

    assert sum(result is not None for result in results) == 1
    current = service.get_current()
    assert sum(question.status == "processing" for question in current.questions) == 1


def test_pause_stops_claiming_until_resume(queued_live):
    service, live_id = queued_live
    service.pause_session(live_id)
    assert service.claim_next_question(live_id) is None

    service.resume_session(live_id)
    assert service.claim_next_question(live_id).question_id == "question-0"


def test_skip_inflight_keeps_slot_until_completion(queued_live):
    service, live_id = queued_live
    service.skip_question(live_id, "question-0")
    active = service.claim_next_question(live_id)
    assert active.question_id == "question-1"

    assert service.skip_question(live_id, active.question_id).status == "skipped"
    assert service.claim_next_question(live_id) is None

    ended = service.end_session(live_id)
    assert all(question.status == "skipped" for question in ended.questions)
    assert service.claim_next_question(live_id) is None


def test_new_session_clears_previous_slot(queued_live):
    service, live_id = queued_live
    service.claim_next_question(live_id)
    service.end_session(live_id)
    new_live = service.create_session(
        LiveSessionCreate(title="New live", scheduled_skus=["BT-XIKE-01"])
    )
    service.start_session(new_live.live_id)
    service.submit_question(
        new_live.live_id,
        LiveQuestionIn(
            question_id="new-question-001", session_id="viewer-test-001", text="Câu hỏi mới"
        ),
    )
    assert service.claim_next_question(new_live.live_id).question_id == "new-question-001"
