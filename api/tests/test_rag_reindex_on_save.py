"""Saving a product in the back office brings the chatbot's passages up to date, with no restart."""

from fastapi.testclient import TestClient
from sqlalchemy import select

from app.main import create_app
from app.modules.rag.models import KbChunk

from .conftest import ADMIN_EMAIL, ADMIN_PASSWORD
from .helpers import ADMIN, make_category, make_product


def _admin(settings) -> TestClient:
    client = TestClient(create_app(settings))
    client.__enter__()
    r = client.post("/api/admin/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD})
    client.headers["X-CSRF-Token"] = r.json()["csrf"]
    return client


def _passages(client: TestClient) -> str:
    with client.app.state.session_factory() as db:
        return "\n".join(r.text for r in db.scalars(select(KbChunk)))


def test_a_saved_product_reaches_the_chatbot_without_a_restart(settings):
    on = settings.model_copy(update={"chat_rag_enabled": True, "rag_embedder": "hash"})
    client = _admin(on)
    try:
        p = make_product(client, publish=True)
        assert (
            client.patch(f"{ADMIN}/products/{p['id']}", json={"spiceLevel": "rất cay Hà Nội"}).status_code
            == 200
        )
        assert "rất cay Hà Nội" in _passages(client)
    finally:
        client.__exit__(None, None, None)


def test_nothing_is_indexed_when_the_chatbot_index_is_off(settings):
    off = settings.model_copy(update={"chat_rag_enabled": False})
    client = _admin(off)
    try:
        p = make_product(client, publish=True)
        client.patch(f"{ADMIN}/products/{p['id']}", json={"spiceLevel": "cay"})
        assert _passages(client) == ""
    finally:
        client.__exit__(None, None, None)


def test_an_approved_faq_and_a_renamed_category_reach_the_chatbot(settings):
    on = settings.model_copy(update={"chat_rag_enabled": True, "rag_embedder": "hash"})
    client = _admin(on)
    try:
        faq = {
            "question": "Shop có xuất hóa đơn không?",
            "answer": "Có, nhắn shop kèm mã số thuế.",
            "approved": True,
        }
        r = client.post("/api/admin/chat/faqs", json=faq)
        assert r.status_code == 200, r.text
        assert "mã số thuế" in _passages(client)

        client.put(f"/api/admin/chat/faqs/{r.json()['id']}", json={**faq, "approved": False})
        assert "mã số thuế" not in _passages(client)  # unapproving takes it back out

        cat = make_category(client, "Danh mục cũ")
        make_product(client, category_id=cat["id"], publish=True)
        client.patch(f"{ADMIN}/categories/{cat['id']}", json={"name": "Danh mục mới tinh"})
        assert "Danh mục mới tinh" in _passages(client)
    finally:
        client.__exit__(None, None, None)
