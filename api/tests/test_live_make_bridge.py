from datetime import UTC, datetime, timedelta, timezone

import pytest

from app.modules.live.make_bridge import build_make_payload
from app.modules.live.schemas import LiveQuestionIn, LiveQuestionOut, LiveSessionCreate
from app.modules.live.service import LiveService


def test_make_payload_keeps_question_context_after_pin_changes():
    service = LiveService()
    live = service.create_session(
        LiveSessionCreate(
            title="Phiên live thử",
            scheduled_skus=["BT-XIKE-01", "KG-LC-250"],
        )
    )
    service.start_session(live.live_id)

    question = service.submit_question(
        live.live_id,
        LiveQuestionIn(
            question_id="question-test-001",
            session_id="viewer-test-001",
            text="Bánh tráng này có cay không?",
        ),
    )

    changed = service.pin_sku(live.live_id, "KG-LC-250")
    claimed = service.claim_next_question(live.live_id)
    assert claimed.question_id == question.question_id
    payload = build_make_payload(claimed, 180)

    assert changed.pinned_sku == "KG-LC-250"
    assert payload["current_live_sku"] == "BT-XIKE-01"
    assert payload["session_id"] == live.live_id
    assert payload["question_id"] == "question-test-001"
    assert payload["question"] == "Bánh tráng này có cay không?"
    assert payload["source"] == "web_live"


@pytest.mark.parametrize(
    ("claimed_at", "timeout", "expected_ms"),
    [
        (datetime(1970, 1, 1, tzinfo=UTC), 180, 180_000),
        (datetime(1970, 1, 1, tzinfo=UTC), 7.5, 7_500),
        (datetime(1970, 1, 1, microsecond=999, tzinfo=UTC), 7.5, 7_500),
        (datetime(1970, 1, 1, microsecond=999, tzinfo=UTC), 0.000001, 1),
        (datetime(1970, 1, 1, microsecond=1, tzinfo=UTC), 0.001234, 1),
        (datetime(1970, 1, 1, 7, tzinfo=timezone(timedelta(hours=7))), 7.5, 7_500),
        (datetime(2026, 11, 11, microsecond=999_999, tzinfo=UTC), 7.5, 1_794_355_208_499),
    ],
)
def test_payload_deadline_uses_backend_timedelta_and_floors_milliseconds(
    claimed_at,
    timeout,
    expected_ms,
):
    question = LiveQuestionOut(
        question_id="deadline-question-001",
        live_id="deadline-live-001",
        text="Question",
        sku="BT-XIKE-01",
        received_at=claimed_at,
        processing_started_at=claimed_at,
    )
    deadline_ms = build_make_payload(question, timeout)["deadline_unix_ms"]
    assert type(deadline_ms) is int
    assert deadline_ms == expected_ms
    exact_deadline = claimed_at + timedelta(seconds=timeout)
    represented = datetime(1970, 1, 1, tzinfo=UTC) + timedelta(milliseconds=deadline_ms)
    assert represented <= exact_deadline < represented + timedelta(milliseconds=1)
