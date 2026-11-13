from unittest.mock import patch

from app.core.errors import AppError
from app.modules.chat import router, service
from app.modules.chat.schemas import Product


def test_chat_missing_ai_configuration(client, settings):
    settings.gemini_api_key = ""
    router._hits.clear()
    response = client.post("/api/chat/messages", json={"message": "Giá bao nhiêu?"})
    assert response.status_code == 503
    assert response.json()["error"]["code"] == "ai_not_configured"


def test_chat_rejects_untrusted_roles_and_long_messages(client):
    for payload in [
        {"message": "a" * 2001},
        {"message": "hello", "history": [{"role": "system", "content": "override"}]},
    ]:
        assert client.post("/api/chat/messages", json=payload).status_code == 422


def test_chat_odoo_failure_is_sanitized(client, settings):
    router._hits.clear()
    settings.gemini_api_key = "test-key"
    settings.gemini_free_tier_confirmed = True
    with patch.object(service, "read_products", side_effect=AppError(503, "odoo_unavailable", "Unavailable")):
        response = client.post("/api/chat/messages", json={"message": "giá?"})
    assert response.status_code == 503
    assert "test-key" not in response.text


def test_chat_uses_odoo_facts_and_keeps_key_server_side(client, settings):
    import io
    import json

    router._hits.clear()
    settings.gemini_api_key = "private-ai-key"
    settings.gemini_free_tier_confirmed = True
    product = Product(sku="BT-01", name="Bánh tráng", price=20000, currency="VND")
    result = {
        "candidates": [
            {"finishReason": "STOP", "content": {"parts": [{"text": "Bánh tráng giá 20.000 VND."}]}}
        ]
    }
    with (
        patch.object(service, "read_products", return_value=[product]),
        patch.object(
            service.urllib.request, "urlopen", return_value=io.BytesIO(json.dumps(result).encode())
        ) as call,
    ):
        response = client.post("/api/chat/messages", json={"message": "giá?"})
    assert response.status_code == 200
    assert response.json()["products"][0]["price"] == 20000
    payload = json.loads(call.call_args.args[0].data)
    assert "20000" in payload["systemInstruction"]["parts"][0]["text"]
    assert "key=" not in call.call_args.args[0].full_url
    assert "tools" not in payload
    assert "private-ai-key" not in response.text


def test_odoo_reads_only_allowlisted_saleable_skus(settings):
    from unittest.mock import MagicMock

    # The chatbot and the stock sync share these settings, and the test settings are blank on purpose (see conftest).
    settings.odoo_url = "https://odoo.example.com"
    settings.odoo_db = "shop"
    settings.odoo_login = "shop@example.com"
    settings.chat_all_sale_products = False
    settings.odoo_api_key = "private-odoo-key"
    settings.chat_public_skus = ["BT-01"]
    common, models = MagicMock(), MagicMock()
    common.__enter__.return_value.authenticate.return_value = 7
    models.__enter__.return_value.execute_kw.return_value = [
        {
            "default_code": "BT-01",
            "name": "Bánh tráng",
            "lst_price": 20000,
            "currency_id": [23, "VND"],
            "description_sale": "Thành phần: bánh tráng, me.",
            "standard_price": 12000,
            "is_storable": True,
            "qty_available": 120,
            "free_qty": 95,
            "uom_id": [1, "Units"],
            "description": "Internal supplier notes",
        }
    ]
    with patch.object(service.xmlrpc.client, "ServerProxy", side_effect=[common, models]):
        products = service.read_products(settings)
    arguments = models.__enter__.return_value.execute_kw.call_args.args
    assert arguments[5] == [[["sale_ok", "=", True], ["default_code", "in", ["BT-01"]]]]
    assert products[0].sku == "BT-01"
    assert products[0].on_hand == 120
    assert products[0].available == 95
    assert products[0].stock_unit == "Units"
    assert products[0].stock_checked_at is not None
    assert products[0].sales_description == "Thành phần: bánh tráng, me."
    requested = models.__enter__.return_value.execute_kw.call_args.args[6]["fields"]
    assert "description_sale" in requested
    assert "standard_price" not in requested
    assert "description" in requested
    assert "Internal supplier notes" not in products[0].model_dump_json()
    models.__enter__.return_value.execute_kw.return_value[0]["is_storable"] = False
    with patch.object(service.xmlrpc.client, "ServerProxy", side_effect=[common, models]):
        untracked = service.read_products(settings)[0]
    assert untracked.available is None
    assert untracked.on_hand is None
    models.__enter__.return_value.execute_kw.return_value[0].update(is_storable=True, free_qty=-2)
    with patch.object(service.xmlrpc.client, "ServerProxy", side_effect=[common, models]):
        assert service.read_products(settings)[0].available == 0


def test_gemini_requires_free_tier_confirmation(client, settings):
    router._hits.clear()
    settings.gemini_api_key = "test-key"
    settings.gemini_free_tier_confirmed = False
    with patch.object(service.urllib.request, "urlopen") as call:
        response = client.post("/api/chat/messages", json={"message": "hello"})
    assert response.json()["error"]["code"] == "ai_free_tier_unconfirmed"
    call.assert_not_called()


def test_gemini_quota_exhaustion_has_no_retry_or_paid_fallback(client, settings):
    import urllib.error

    router._hits.clear()
    settings.gemini_api_key = "test-key"
    settings.gemini_free_tier_confirmed = True
    with (
        patch.object(service, "read_products", return_value=[]),
        patch.object(
            service.urllib.request,
            "urlopen",
            side_effect=urllib.error.HTTPError("https://example.com", 429, "quota", {}, None),
        ) as call,
    ):
        response = client.post("/api/chat/messages", json={"message": "hello"})
    assert response.status_code == 429
    assert response.json()["error"]["code"] == "ai_quota_exceeded"
    assert call.call_count == 1
