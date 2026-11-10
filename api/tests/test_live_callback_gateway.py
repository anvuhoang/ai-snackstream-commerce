import io
import json
from unittest.mock import MagicMock
from urllib.error import HTTPError, URLError

import pytest
from fastapi.testclient import TestClient
from pydantic import SecretStr

from dev_callback_gateway import create_callback_gateway

TOKEN = "gateway-test-token-" + "x" * 32
HEADERS = {"X-Live-Make-Token": TOKEN}
PATH = "/api/live/make-result"
PAYLOAD = {
    "liveId": "live-test-001",
    "questionId": "question-test-001",
    "sku": "BT-XIKE-01",
    "status": "ready",
    "replyText": "Thông tin chưa được xác minh.",
    "videoUrl": "https://example.invalid/avatar.mp4",
}


@pytest.fixture
def gateway_client(settings, monkeypatch):
    settings.live_make_callback_token = SecretStr(TOKEN)
    response = MagicMock()
    response.__enter__.return_value = response
    response.getcode.return_value = 200
    response.read.return_value = b'{"received":true,"applied":true,"reason":"accepted"}'
    opener = MagicMock(return_value=response)
    monkeypatch.setattr("dev_callback_gateway.urlopen", opener)
    with TestClient(create_callback_gateway(settings)) as client:
        yield client, opener


def test_only_valid_callback_is_forwarded(gateway_client):
    client, opener = gateway_client
    response = client.post(PATH, headers=HEADERS, json=PAYLOAD)
    assert response.status_code == 200
    assert response.json()["applied"]
    opener.assert_called_once()
    forwarded = opener.call_args.args[0]
    assert forwarded.full_url == "http://127.0.0.1:8000/api/live/make-result"
    assert forwarded.get_method() == "POST"
    assert forwarded.get_header("X-live-make-token") == TOKEN
    assert json.loads(forwarded.data)["replyText"] == PAYLOAD["replyText"]
    assert opener.call_args.kwargs["timeout"] == 10


@pytest.mark.parametrize("headers", [{}, {"X-Live-Make-Token": "wrong"}])
def test_invalid_token_never_reaches_backend(gateway_client, headers):
    client, opener = gateway_client
    assert client.post(PATH, headers=headers, json=PAYLOAD).status_code == 403
    opener.assert_not_called()


def test_empty_json_without_token_is_a_safe_connectivity_probe(gateway_client):
    client, opener = gateway_client
    assert client.post(PATH, json={}).status_code == 403
    opener.assert_not_called()


@pytest.mark.parametrize(
    "path",
    ["/", "/api/admin/live", "/api/admin/auth/login", "/api/live/current", "/api/docs", "/openapi.json"],
)
def test_other_routes_are_not_forwarded(gateway_client, path):
    client, opener = gateway_client
    assert client.post(path, headers=HEADERS, json=PAYLOAD).status_code == 404
    opener.assert_not_called()


def test_backend_error_status_is_preserved(gateway_client):
    client, opener = gateway_client
    content = b'{"error":{"code":"live_make_callback_forbidden","message":"Invalid callback token."}}'
    opener.side_effect = HTTPError("http://127.0.0.1:8000", 403, "Forbidden", None, io.BytesIO(content))
    response = client.post(PATH, headers=HEADERS, json=PAYLOAD)
    assert response.status_code == 403
    assert response.json()["error"]["code"] == "live_make_callback_forbidden"


def test_backend_unavailable_returns_bounded_error(gateway_client):
    client, opener = gateway_client
    opener.side_effect = URLError("private internal exception")
    response = client.post(PATH, headers=HEADERS, json=PAYLOAD)
    assert response.status_code == 502
    assert response.json()["error"]["code"] == "live_backend_unavailable"
    assert "private internal exception" not in response.text


def test_invalid_result_is_not_forwarded(gateway_client):
    client, opener = gateway_client
    invalid = {**PAYLOAD, "videoUrl": "http://example.invalid/avatar.mp4"}
    assert client.post(PATH, headers=HEADERS, json=invalid).status_code == 422
    opener.assert_not_called()
