from app.modules.live.make_bridge import build_make_payload
from app.modules.live.schemas import LiveQuestionIn, LiveSessionCreate
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
    payload = build_make_payload(question)

    assert changed.pinned_sku == "KG-LC-250"
    assert payload["current_live_sku"] == "BT-XIKE-01"
    assert payload["session_id"] == live.live_id
    assert payload["question_id"] == "question-test-001"
    assert payload["question"] == "Bánh tráng này có cay không?"
    assert payload["source"] == "web_live"