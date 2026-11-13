import io
import os
from pathlib import Path
from unittest.mock import MagicMock
from urllib.error import HTTPError, URLError

import pytest
from fastapi.testclient import TestClient
from pydantic import SecretStr

from app.modules.live import media_metadata as media
from dev_callback_gateway import _NoRedirect, create_callback_gateway

TOKEN = "media-gateway-test-" + "x" * 32
HEADERS = {"X-Live-Make-Token": TOKEN, "Content-Type": "video/mp4"}
PATH = "/api/live/media-metadata"
MP4 = b"\x00\x00\x00\x18ftypisom\x00\x00\x00\x00isommp42" + b"exact-raw-bytes"


@pytest.fixture
def gateway(settings, monkeypatch):
    settings.live_make_enabled = True
    settings.live_make_callback_token = SecretStr(TOKEN)
    upstream = MagicMock()
    upstream.__enter__.return_value = upstream
    upstream.read.return_value = b'{"durationSeconds":4.365011}'
    upstream.getcode.return_value = 200
    opener = MagicMock(return_value=upstream)
    monkeypatch.setattr("dev_callback_gateway.media_urlopen", opener)
    with TestClient(create_callback_gateway(settings)) as client:
        yield client, opener, upstream


def test_gateway_forwards_exact_mp4_token_and_response(gateway):
    client, opener, upstream = gateway
    response = client.post(PATH, content=MP4, headers=HEADERS)
    assert response.status_code == 200
    assert response.content == b'{"durationSeconds":4.365011}'
    opener.assert_called_once()
    request = opener.call_args.args[0]
    assert request.full_url == "http://127.0.0.1:8000/api/live/media-metadata"
    assert request.get_method() == "POST"
    assert request.data == MP4
    assert request.get_header("X-live-make-token") == TOKEN
    assert request.get_header("Content-type") == "video/mp4"
    assert opener.call_args.kwargs["timeout"] == 15
    upstream.read.assert_called_once_with(32769)


@pytest.mark.parametrize("token", [None, "incorrect"])
def test_gateway_rejects_bad_token_without_forwarding(gateway, token):
    client, opener, _ = gateway
    headers = {"Content-Type": "video/mp4"}
    if token:
        headers["X-Live-Make-Token"] = token
    assert client.post(PATH, content=MP4, headers=headers).status_code == 403
    opener.assert_not_called()


@pytest.mark.parametrize(("make", "mock"), [(False, False), (False, True), (True, True)])
def test_gateway_make_mode_only(gateway, make, mock):
    client, opener, _ = gateway
    client.app.state.settings.live_make_enabled = make
    client.app.state.settings.live_mock_enabled = mock
    assert client.post(PATH, content=MP4, headers=HEADERS).status_code == 503
    opener.assert_not_called()


def test_gateway_upload_limits_and_invalid_body(gateway, monkeypatch):
    client, opener, _ = gateway
    monkeypatch.setattr(media, "MAX_MEDIA_BYTES", len(MP4))
    for headers in [{**HEADERS, "Content-Length": str(len(MP4) + 1)}, {**HEADERS, "Content-Length": "1"}]:
        assert client.post(PATH, content=MP4 + b"x", headers=headers).status_code == 413
    assert client.post(PATH, content=b"not mp4", headers=HEADERS).status_code == 422
    assert (
        client.post(
            PATH, json={"url": "https://example.invalid/video.mp4"}, headers={"X-Live-Make-Token": TOKEN}
        ).status_code
        == 415
    )
    opener.assert_not_called()


@pytest.mark.parametrize("status", [422, 503, 504])
def test_gateway_preserves_backend_errors(gateway, status):
    client, opener, _ = gateway
    content = b'{"error":{"code":"live_ffprobe_timeout","message":"Media inspection timed out."}}'
    opener.side_effect = HTTPError("http://127.0.0.1:8000", status, "Error", None, io.BytesIO(content))
    response = client.post(PATH, content=MP4, headers=HEADERS)
    assert response.status_code == status
    assert response.content == content


def test_gateway_connection_error_does_not_leak(gateway):
    client, opener, _ = gateway
    opener.side_effect = URLError("private detail")
    response = client.post(PATH, content=MP4, headers=HEADERS)
    assert response.status_code == 502
    assert "private detail" not in response.text


@pytest.mark.parametrize(("size", "status"), [(32769, 200), (10, 302)])
def test_gateway_bounds_response_and_never_follows_redirect(gateway, size, status):
    client, _, upstream = gateway
    upstream.read.return_value = b"x" * size
    upstream.getcode.return_value = status
    response = client.post(PATH, content=MP4, headers=HEADERS)
    assert response.status_code == 502
    assert response.json()["error"]["code"] == "live_backend_response_invalid"
    assert _NoRedirect().redirect_request(None, None, 302, "", {}, "https://example.invalid") is None


def test_real_fixture_through_gateway_to_backend(client, monkeypatch):
    fixture, executable = os.environ.get("LIVE_MEDIA_TEST_FIXTURE"), os.environ.get("LIVE_MEDIA_TEST_FFPROBE")
    if not fixture or not executable:
        pytest.skip("Real MP4 and ffprobe test paths are not configured")
    settings = client.app.state.settings
    settings.live_make_enabled = True
    settings.live_make_callback_token = SecretStr(TOKEN)
    settings.live_ffprobe_path = executable
    content = Path(fixture).read_bytes()

    def local_transport(request, **kwargs):
        assert request.data == content
        assert request.get_header("X-live-make-token") == TOKEN
        response = client.post(PATH, content=request.data, headers=HEADERS)
        upstream = io.BytesIO(response.content)
        upstream.getcode = lambda: response.status_code
        return upstream

    monkeypatch.setattr("dev_callback_gateway.media_urlopen", local_transport)
    with TestClient(create_callback_gateway(settings)) as gateway:
        response = gateway.post(PATH, content=content, headers=HEADERS)
    assert response.status_code == 200
    assert response.json()["durationSeconds"] == pytest.approx(4.365011, abs=0.001)
