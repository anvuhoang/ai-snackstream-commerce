from unittest.mock import patch

from sqlalchemy import select

from app.modules.chat import router
from app.modules.chat.models import ChatLog
from app.modules.chat.schemas import ChatResponse, Product


def ask(client):
    router._hits.clear()
    with patch.object(
        router,
        "answer_chat",
        return_value=ChatResponse(
            answer="Bánh tráng giá 20.000 VND",
            products=[Product(sku="BT-01", name="Bánh tráng", price=20000, currency="VND")],
        ),
    ):
        return client.post("/api/chat/messages", json={"message": "Giá?", "sku": "BT-01"})


def test_logs_persist_conversation_and_card_click(client, signed_in):
    first = ask(client).json()
    second = ask(client).json()
    page = signed_in.get("/api/admin/chat/logs").json()
    assert page["total"] == 2
    assert page["items"][0]["conversationId"] == page["items"][1]["conversationId"]
    assert page["items"][0]["outcome"] == "answered"
    assert page["items"][0]["reviewedCorrect"] is None
    assert page["items"][0]["durationMs"] >= 0
    assert page["items"][0]["receivedAt"].endswith("Z")
    question = first["questionId"]
    url = f"/api/chat/questions/{question}/click"
    assert client.post(url, json={"sku": "unrelated"}).status_code == 422
    assert client.post(url, json={"sku": "BT-01"}).status_code == 204
    client.cookies.delete("ss_chat")
    assert client.post(url, json={"sku": "BT-01"}).status_code == 404
    assert first["questionId"] != second["questionId"]


def test_admin_log_auth_and_review_csrf(client, signed_in):
    question = ask(client).json()["questionId"]
    url = f"/api/admin/chat/logs/{question}"
    assert signed_in.patch(url, json={"reviewedCorrect": False}).status_code == 200
    assert signed_in.get("/api/admin/chat/logs?needs_review=true").json()["total"] == 0
    signed_in.headers.pop("X-CSRF-Token")
    assert signed_in.patch(url, json={"reviewedCorrect": True}).status_code == 403
    client.cookies.clear()
    assert client.get("/api/admin/chat/logs").status_code == 401
    assert client.patch(url, json={"reviewedCorrect": True}).status_code == 401


def test_service_error_is_logged_without_secret(client, settings):
    settings.gemini_api_key = ""
    router._hits.clear()
    response = client.post("/api/chat/messages", json={"message": "hello"})
    assert response.status_code == 503
    with client.app.state.session_factory() as db:
        row = db.scalar(select(ChatLog))
        assert row.outcome == "error"
        assert row.error_code == "ai_not_configured"
        assert row.answer is None
