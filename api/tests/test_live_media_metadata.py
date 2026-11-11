import asyncio
import json
import os
import subprocess
from pathlib import Path
from threading import Event
from types import SimpleNamespace

import httpx
import pytest
from fastapi import Request
from pydantic import SecretStr
from starlette.requests import ClientDisconnect

from app.core.errors import AppError
from app.modules.live import media_metadata as media
from app.modules.live.router import live_events
from app.modules.live.schemas import LiveQuestionIn, LiveSessionCreate

TOKEN = "media-test-token-" + "x" * 32
HEADERS = {"X-Live-Make-Token": TOKEN, "Content-Type": "video/mp4"}
PATH = "/api/live/media-metadata"
MP4 = b"\x00\x00\x00\x18ftypisom\x00\x00\x00\x00isommp42" + b"synthetic-test"


def probe_output(duration="4.365011"):
    return {
        "format": {"format_name": "mov,mp4,m4a,3gp,3g2,mj2", "duration": duration},
        "streams": [{"codec_type": "video"}],
    }


@pytest.fixture
def media_client(client, monkeypatch):
    settings = client.app.state.settings
    settings.live_make_enabled = True
    settings.live_make_callback_token = SecretStr(TOKEN)
    settings.live_ffprobe_path = "test-ffprobe"
    files = []

    def fake_run(argv, **kwargs):
        path = Path(argv[argv.index("-i") + 1])
        files.append(path)
        assert path.read_bytes() == MP4
        assert kwargs["timeout"] == media.FFPROBE_TIMEOUT_SECONDS
        assert kwargs["shell"] is False and kwargs["check"] is True
        assert argv[0] == "test-ffprobe"
        assert argv[argv.index("-protocol_whitelist") + 1] == "file"
        assert "format=format_name,duration:stream=codec_type" in argv
        return SimpleNamespace(stdout=json.dumps(probe_output()).encode())

    monkeypatch.setattr(media.subprocess, "run", fake_run)
    return client, files


def test_raw_mp4_returns_numeric_container_duration_and_cleans_temp(media_client):
    client, files = media_client
    response = client.post(PATH, content=MP4, headers=HEADERS)
    assert response.status_code == 200
    assert response.json() == {"durationSeconds": 4.365011}
    assert type(response.json()["durationSeconds"]) is float
    assert len(files) == 1
    assert not files[0].parent.exists()


@pytest.mark.parametrize("token", [None, "wrong"])
def test_missing_or_wrong_token_never_probes(media_client, token):
    client, files = media_client
    headers = {"Content-Type": "video/mp4"}
    if token is not None:
        headers["X-Live-Make-Token"] = token
    assert client.post(PATH, content=MP4, headers=headers).status_code == 403
    assert files == []


@pytest.mark.parametrize(("make", "mock"), [(False, False), (False, True), (True, True)])
def test_other_modes_never_probe(media_client, make, mock):
    client, files = media_client
    settings = client.app.state.settings
    settings.live_make_enabled, settings.live_mock_enabled = make, mock
    response = client.post(PATH, content=MP4, headers=HEADERS)
    assert response.status_code == 503
    assert response.json()["error"]["code"] == "live_make_disabled"
    assert files == []


@pytest.mark.parametrize("content_type", ["application/json", "application/octet-stream", ""])
def test_only_raw_mp4_content_type(media_client, content_type):
    client, files = media_client
    response = client.post(PATH, content=MP4, headers={**HEADERS, "Content-Type": content_type})
    assert response.status_code == 415
    assert files == []


@pytest.mark.parametrize(
    "content",
    [
        b"",
        b"broken",
        b"RIFF" + b"0" * 30,
        b'{"url":"https://example.invalid/video.mp4"}',
        b"\x00\x00\x00\x18ftypqt  " + b"0" * 16,
    ],
)
def test_not_mp4_never_probes(media_client, content):
    client, files = media_client
    assert client.post(PATH, content=content, headers=HEADERS).status_code == 422
    assert files == []


def test_declared_and_streamed_size_limits(media_client, monkeypatch):
    client, files = media_client
    monkeypatch.setattr(media, "MAX_MEDIA_BYTES", len(MP4))
    assert client.post(PATH, content=MP4, headers=HEADERS).status_code == 200
    for headers in [{**HEADERS, "Content-Length": str(len(MP4) + 1)}, {**HEADERS, "Content-Length": "1"}]:
        assert client.post(PATH, content=MP4 + b"x", headers=headers).status_code == 413
    assert len(files) == 1


@pytest.mark.parametrize("length", ["-1", "invalid", "9" * 4301])
def test_invalid_content_length(media_client, length):
    client, files = media_client
    response = client.post(PATH, content=MP4, headers={**HEADERS, "Content-Length": length})
    assert response.status_code == 400
    assert not files


@pytest.mark.parametrize(
    "duration", [None, "N/A", "NaN", "inf", "-inf", "0", "-1", "300.001", True, {}, [], 10**1000]
)
def test_invalid_duration_is_rejected_and_cleaned(media_client, monkeypatch, duration):
    client, _ = media_client
    paths = []

    def fake_run(argv, **kwargs):
        paths.append(Path(argv[argv.index("-i") + 1]))
        return SimpleNamespace(stdout=json.dumps(probe_output(duration)).encode())

    monkeypatch.setattr(media.subprocess, "run", fake_run)
    response = client.post(PATH, content=MP4, headers=HEADERS)
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "live_media_duration_invalid"
    assert not paths[0].parent.exists()


@pytest.mark.parametrize(
    "output",
    [
        b"garbage",
        b"{}",
        b"[]",
        b"x" * 32769,
        b'{"format":{"duration":"5","format_name":"avi"},"streams":[]}',
        b'{"format":{"duration":"5","format_name":"mp4"},"streams":[]}',
    ],
)
def test_unusable_probe_output(media_client, monkeypatch, output):
    client, _ = media_client
    monkeypatch.setattr(media.subprocess, "run", lambda *a, **kw: SimpleNamespace(stdout=output))
    assert client.post(PATH, content=MP4, headers=HEADERS).status_code == 422


@pytest.mark.parametrize(
    ("failure", "status", "code"),
    [
        (FileNotFoundError(), 503, "live_ffprobe_unavailable"),
        (PermissionError(), 503, "live_ffprobe_unavailable"),
        (subprocess.CalledProcessError(1, "private-command"), 422, "live_media_invalid"),
        (subprocess.TimeoutExpired("private-command", 10), 504, "live_ffprobe_timeout"),
    ],
)
def test_probe_failures_clean_temp_and_hide_details(media_client, monkeypatch, failure, status, code):
    client, _ = media_client
    paths = []

    def fail(argv, **kwargs):
        paths.append(Path(argv[argv.index("-i") + 1]))
        assert paths[0].is_file()
        raise failure

    monkeypatch.setattr(media.subprocess, "run", fail)
    response = client.post(PATH, content=MP4, headers=HEADERS)
    assert response.status_code == status
    assert response.json()["error"]["code"] == code
    assert "private-command" not in response.text
    assert not paths[0].parent.exists()


def test_real_missing_executable_does_not_prevent_app_start(client):
    client.app.state.settings.live_make_enabled = True
    client.app.state.settings.live_make_callback_token = SecretStr(TOKEN)
    client.app.state.settings.live_ffprobe_path = "snackstream-nonexistent-ffprobe-12345"
    assert client.get("/api/live/current").status_code == 200
    response = client.post(PATH, content=MP4, headers=HEADERS)
    assert response.status_code == 503
    assert response.json()["error"]["code"] == "live_ffprobe_unavailable"


def test_measurement_does_not_change_live_or_queue(media_client):
    client, _ = media_client
    live = client.app.state.live
    session = live.create_session(LiveSessionCreate(title="No mutation", scheduled_skus=["BT-XIKE-01"]))
    live.start_session(session.live_id)
    for i in range(2):
        live.submit_question(
            session.live_id,
            LiveQuestionIn(
                question_id=f"media-question-{i}",
                session_id="media-viewer-001",
                text="Question",
            ),
        )
    live.claim_next_question(session.live_id)
    before = live.get_current().model_dump()
    assert client.post(PATH, content=MP4, headers=HEADERS).status_code == 200
    assert live.get_current().model_dump() == before
    assert live.claim_next_question(session.live_id) is None


def test_upload_timeout_disconnect_and_chunked_size(media_client, monkeypatch):
    client, _ = media_client

    async def exercise():
        scope = {
            "type": "http",
            "method": "POST",
            "path": PATH,
            "app": client.app,
            "headers": [(b"content-type", b"video/mp4")],
        }

        async def slow():
            await asyncio.sleep(1)

        monkeypatch.setattr(media, "UPLOAD_TIMEOUT_SECONDS", 0.01)
        with pytest.raises(AppError) as caught:
            await media.read_mp4(Request(scope, slow))
        assert caught.value.code == "live_media_upload_timeout"

        async def disconnect():
            raise ClientDisconnect

        with pytest.raises(AppError) as caught:
            await media.read_mp4(Request(scope, disconnect))
        assert caught.value.code == "live_media_upload_incomplete"

        monkeypatch.setattr(media, "MAX_MEDIA_BYTES", len(MP4))
        chunks = iter([MP4, b"x"])

        async def receive():
            return {"type": "http.request", "body": next(chunks), "more_body": True}

        with pytest.raises(AppError) as caught:
            await media.read_mp4(Request(scope, receive))
        assert caught.value.code == "live_media_too_large"

    asyncio.run(exercise())


def test_blocked_ffprobe_keeps_api_and_sse_responsive(media_client, monkeypatch):
    client, _ = media_client
    started, release = Event(), Event()

    def blocked(*args, **kwargs):
        started.set()
        assert release.wait(5)
        return SimpleNamespace(stdout=json.dumps(probe_output()).encode())

    monkeypatch.setattr(media.subprocess, "run", blocked)

    async def exercise():
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=client.app), base_url="http://test"
        ) as api:
            pending = asyncio.create_task(api.post(PATH, content=MP4, headers=HEADERS))
            try:
                assert await asyncio.to_thread(started.wait, 2)
                response = await asyncio.wait_for(api.get("/api/live/current"), 1)
                assert response.status_code == 200
                request = SimpleNamespace(app=client.app, is_disconnected=lambda: asyncio.sleep(0, False))
                events = await live_events(request)
                assert "event: state" in await asyncio.wait_for(anext(events.body_iterator), 1)
                await events.body_iterator.aclose()
            finally:
                release.set()
                assert (await pending).status_code == 200

    asyncio.run(exercise())


def test_real_did_fixture(client):
    fixture = os.environ.get("LIVE_MEDIA_TEST_FIXTURE")
    executable = os.environ.get("LIVE_MEDIA_TEST_FFPROBE")
    if not fixture or not executable:
        pytest.skip("Set LIVE_MEDIA_TEST_FIXTURE and LIVE_MEDIA_TEST_FFPROBE for real MP4 verification")
    settings = client.app.state.settings
    settings.live_make_enabled = True
    settings.live_make_callback_token = SecretStr(TOKEN)
    settings.live_ffprobe_path = executable
    response = client.post(PATH, content=Path(fixture).read_bytes(), headers=HEADERS)
    assert response.status_code == 200, response.text
    assert type(response.json()["durationSeconds"]) in (int, float)
    assert response.json()["durationSeconds"] == pytest.approx(4.365011, abs=0.001)
    # A file with a plausible ftyp box but no playable MP4 is rejected by real ffprobe.
    assert client.post(PATH, content=MP4, headers=HEADERS).status_code == 422
