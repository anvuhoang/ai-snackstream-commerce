from unittest.mock import patch

from app.modules.chat import router
from app.modules.chat.schemas import ChatResponse


def test_disabled_bot_never_calls_ai_and_status_is_public(signed_in):
    client = signed_in
    assert (
        client.put(
            "/api/admin/chat/settings", json={"enabled": False, "contactText": "Liên hệ cửa hàng để hỗ trợ."}
        ).status_code
        == 200
    )
    router._hits.clear()
    with patch.object(router, "answer_chat") as ai:
        r = client.post("/api/chat/messages", json={"message": "hello"})
    assert r.json()["error"]["code"] == "bot_disabled"
    ai.assert_not_called()
    client.cookies.clear()
    assert client.get("/api/chat/status").json()["enabled"] is False


def test_faq_drafts_excluded_and_crud_protected(signed_in):
    client = signed_in
    for approved in [False, True]:
        assert (
            client.post(
                "/api/admin/chat/faqs",
                json={"question": "Giao hàng?", "answer": "Chính sách đã xác minh", "approved": approved},
            ).status_code
            == 200
        )
    router._hits.clear()
    with patch.object(router, "answer_chat", return_value=ChatResponse(answer="hello", products=[])) as ai:
        assert client.post("/api/chat/messages", json={"message": "hello"}).status_code == 200
    faqs = ai.call_args.args[2]
    assert len(faqs) == 1 and faqs[0].approved is True
    faq_id = client.get("/api/admin/chat/faqs").json()[0]["id"]
    assert (
        client.put(
            f"/api/admin/chat/faqs/{faq_id}",
            json={"question": "Đổi trả?", "answer": "Đáp án mới", "approved": False},
        ).status_code
        == 200
    )
    token = client.headers.pop("X-CSRF-Token")
    assert client.delete(f"/api/admin/chat/faqs/{faq_id}").status_code == 403
    client.headers["X-CSRF-Token"] = token
    assert client.delete(f"/api/admin/chat/faqs/{faq_id}").status_code == 204
    client.cookies.clear()
    assert client.get("/api/admin/chat/faqs").status_code == 401
    assert client.post("/api/admin/chat/faqs", json={"question": "x", "answer": "x"}).status_code == 401


def test_support_idempotency_takeover_and_resolution(signed_in):
    client = signed_in
    router._hits.clear()
    assert client.post("/api/chat/support", json={"message": "help"}).status_code == 403
    headers = {"X-Chat-Action": "support"}
    first = client.post("/api/chat/support", headers=headers, json={"message": "help"}).json()
    second = client.post("/api/chat/support", headers=headers, json={"message": "help"}).json()
    assert first["id"] == second["id"]
    assert client.get("/api/chat/status").json()["supportState"] == "requested"
    url = f"/api/admin/chat/support/{first['id']}"
    assert client.patch(url, json={"state": "active"}).status_code == 200
    with patch.object(router, "answer_chat") as ai:
        r = client.post("/api/chat/messages", json={"message": "hello"})
    assert r.json()["error"]["code"] == "human_takeover"
    ai.assert_not_called()
    assert client.patch(url, json={"state": "resolved"}).status_code == 200
    assert client.patch(url, json={"state": "active"}).status_code == 409
    assert client.get("/api/chat/status").json()["supportState"] == "resolved"
    client.cookies.clear()
    assert client.get("/api/chat/status").json()["supportState"] is None
    assert client.get("/api/admin/chat/support").status_code == 401
