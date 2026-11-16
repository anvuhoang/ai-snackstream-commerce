import io
import json
import os
import wave
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from threading import Event

import httpx
import pytest
from pydantic import SecretStr

from app.modules.live import content, content_router, make_bridge
from app.modules.live.content import ContentSettings, get_content_settings
from app.modules.live.schemas import LiveQuestionIn, LiveSessionCreate
from app.modules.live.service import LiveService

PRODUCT = {
    "sku": "KG-LC-250",
    "name": "Khô gà lá chanh 250 g",
    "facts": "Thông tin do admin cung cấp.\nBảo quản theo nhãn.",
}


SCRIPT = (
    "Xin chào mọi người! Hôm nay chúng ta cùng tìm hiểu Khô gà lá chanh 250 g, mã KG-LC-250. "
    "Nội dung giới thiệu dựa trên thông tin được cung cấp cho phiên live này. "
    "Khi bảo quản sản phẩm, bạn hãy làm theo hướng dẫn trên nhãn. "
    "Nếu bạn muốn hỏi thêm về sản phẩm hoặc có điều gì cần làm rõ, "
    "hãy gửi câu hỏi ngay trong phiên để chúng ta cùng trao đổi nhé!"
)


@pytest.fixture
def prepared(signed_in, monkeypatch):
    c = signed_in
    s = c.app.state.settings
    s.live_simli_enabled = True
    s.live_simli_transport = "mock"
    # Wrong legacy SKU/audio must never be used for a newly prepared narration.
    s.live_simli_audio_sku = "BT-XIKE-01"
    s.live_simli_audio_path = "missing-legacy-audio.pcm"
    cfg = ContentSettings(
        LIVE_CONTENT_ENABLED=True,
        ELEVENLABS_API_KEY="fake-tts-key",
        ELEVENLABS_VOICE_ID="test-voice",
        ELEVENLABS_MODEL_ID="fake-vi-model",
    )
    c.app.dependency_overrides[get_content_settings] = lambda: cfg
    pcm_path = os.getenv("LIVE_TEST_HOST_PCM")
    # The restore regression intentionally hands off at 6.926 s, so its default
    # audio must extend past that offset in CI without any external fixture.
    pcm = Path(pcm_path).read_bytes() if pcm_path else b"\x10\x00" * 16000 * 10
    requests = []
    real_client = httpx.Client

    def handle(request):
        requests.append(request)
        assert request.url.host == "api.elevenlabs.io"
        assert request.url.params["output_format"] == "wav_16000"
        assert json.loads(request.content)["language_code"] == "vi"
        file = io.BytesIO()
        with wave.open(file, "wb") as audio:
            audio.setparams((1, 2, 16000, 0, "NONE", "not compressed"))
            audio.writeframes(pcm)
        return httpx.Response(200, content=file.getvalue(), headers={"content-type": "audio/wav"})

    monkeypatch.setattr(
        content.httpx, "Client", lambda **kw: real_client(transport=httpx.MockTransport(handle), **kw)
    )
    r = c.post(
        "/api/admin/live",
        json={
            "title": "Product host",
            "hostMode": "simli",
            "scheduledSkus": ["KG-LC-250"],
            "products": [PRODUCT],
        },
    )
    assert r.status_code == 201, r.text
    sid = r.json()["liveId"]
    return c, sid, cfg, pcm, requests


def routes(sid):
    return f"/api/admin/live/{sid}/content"


def test_script_review_audio_and_existing_host_path(prepared):
    c, sid, _, pcm, requests = prepared
    base = routes(sid)
    assert not requests  # Session creation/F5/readiness must not call any provider.
    cid = {"clientId": "content-host-client"}
    assert c.post(f"/api/admin/live/{sid}/host/acquire", json=cid).status_code == 409
    script = SCRIPT
    assert c.put(base + "/script", json={"script": script}).status_code == 200
    assert c.put(base + "/script", json={"script": script}).json()["script"] == script
    assert requests == []
    assert c.post(base + "/audio", json={"script": "a different script"}).status_code == 409
    assert len(requests) == 0
    result = c.post(base + "/audio", json={"script": script})
    assert result.status_code == 200, result.text
    assert result.json()["durationSeconds"] == len(pcm) / 32000
    assert result.json()["audioFormat"] == "pcm_s16le_16000_mono"
    assert json.loads(requests[-1].content)["text"] == script
    assert c.post(base + "/audio", json={"script": script}).status_code == 200
    assert len(requests) == 1
    acquire = c.post(f"/api/admin/live/{sid}/host/acquire", json=cid)
    assert acquire.status_code == 200, acquire.text
    c.headers["X-Live-Host-Lease"] = acquire.json()["leaseId"]
    token = c.post(f"/api/admin/live/{sid}/host/token", json=cid)
    assert token.json()["transport"] == "mock"
    audio = c.post(f"/api/admin/live/{sid}/host/audio", json=cid)
    assert audio.content == pcm
    assert acquire.json()["session"]["host"]["durationSeconds"] == len(pcm) / 32000
    assert c.put(base + "/script", json={"script": script}).status_code == 409
    assert "fake-tts-key" not in c.get(base).text


@pytest.mark.parametrize(
    "payload",
    [
        {},
        {"script": True},
        {"script": 42},
        {"script": []},
        {"script": "a" * 2001},
        {"script": SCRIPT, "extra": True},
        [],
    ],
)
def test_invalid_manual_script_never_reaches_tts(prepared, payload):
    c, sid, _, _, requests = prepared
    assert c.put(routes(sid) + "/script", json=payload).status_code == 422
    assert c.get(routes(sid)).json()["script"] is None
    assert requests == []


def test_script_generation_endpoint_is_not_exposed(prepared):
    c, sid, _, _, requests = prepared
    assert c.post(routes(sid) + "/script").status_code == 405
    assert "post" not in c.app.openapi()["paths"]["/api/admin/live/{live_id}/content/script"]
    assert requests == []


def test_product_snapshot_in_make_payload_and_callback_restore(prepared, live_catalog, monkeypatch):
    c, sid, _, _, _ = prepared
    base = routes(sid)
    script = SCRIPT
    assert c.put(base + "/script", json={"script": script}).status_code == 200
    assert c.post(base + "/audio", json={"script": script}).status_code == 200
    cid = {"clientId": "content-host-client"}
    lease = c.post(f"/api/admin/live/{sid}/host/acquire", json=cid).json()["leaseId"]
    c.headers["X-Live-Host-Lease"] = lease
    assert c.post(f"/api/admin/live/{sid}/host/token", json=cid).status_code == 200
    seq = 0

    def action(kind, offset=None, qid=None):
        nonlocal seq
        seq += 1
        return c.post(
            f"/api/admin/live/{sid}/host/action",
            json={
                **cid,
                "requestId": f"content-action-{seq}",
                "action": kind,
                "offsetSeconds": offset,
                "questionId": qid,
            },
        )

    assert action("ready").status_code == 200
    s = c.app.state.settings
    s.live_make_enabled, s.live_mock_enabled = True, False
    s.live_make_webhook_url = SecretStr("https://make.invalid.test/webhook")
    s.live_make_callback_token = SecretStr("fake-callback-token-00000000000000")
    payloads = []

    class Reply:
        status = 200

        def __enter__(self):
            return self

        def __exit__(self, *args):
            return False

    def send(request, **kwargs):
        payloads.append(json.loads(request.data))
        return Reply()

    monkeypatch.setattr(make_bridge, "urlopen", send)
    body = {
        "questionId": "real-path-question-001",
        "sessionId": "viewer-content-001",
        "text": "Bảo quản thế nào?",
    }
    question = c.post(f"/api/live/{sid}/questions", json=body)
    assert question.status_code == 200
    assert payloads[0]["product"]["sku"] == PRODUCT["sku"]
    assert payloads[0]["product"]["name"] == "Catalog KG-LC-250"
    assert "Keep dry from database" in payloads[0]["product"]["facts"]
    assert PRODUCT["facts"] not in payloads[0]["product"]["facts"]
    assert payloads[0]["current_live_sku"] == PRODUCT["sku"]
    assert type(payloads[0]["deadline_unix_ms"]) is int
    assert c.post(f"/api/live/{sid}/questions", json=body).status_code == 200
    assert len(payloads) == 1
    qid = body["questionId"]
    callback = {
        "liveId": sid,
        "questionId": qid,
        "sku": PRODUCT["sku"],
        "status": "ready",
        "replyText": "Bảo quản theo nhãn.",
        "videoUrl": "https://media.invalid.test/reply.mp4",
        "durationSeconds": 5.108005,
    }
    response = c.post(
        "/api/live/make-result",
        json=callback,
        headers={"X-Live-Make-Token": "fake-callback-token-00000000000000"},
    )
    assert response.json()["reason"] == "accepted"
    assert (
        c.post(
            "/api/live/make-result",
            json=callback,
            headers={"X-Live-Make-Token": "fake-callback-token-00000000000000"},
        ).json()["reason"]
        == "duplicate"
    )
    assert action("handoff", 6.926, qid).status_code == 200
    assert action("reply_playing", None, qid).status_code == 200
    assert action("reply_ended", None, qid).status_code == 200
    assert action("restored", 6.746, qid).status_code == 200
    current = c.get("/api/live/current").json()["session"]
    assert current["questions"][0]["status"] == "answered"
    assert current["host"]["offsetSeconds"] == 6.746
    assert action("stop").json()["session"]["status"] == "ended"


@pytest.mark.parametrize("bad", [b"", b"odd", b"\0" * 32000, b"RIFF" + b"a" * 40000, b"a" * (91 * 32000)])
def test_invalid_audio_no_legacy_fallback(prepared, monkeypatch, bad):
    c, sid, _, _, _ = prepared
    script = SCRIPT
    assert c.put(routes(sid) + "/script", json={"script": script}).status_code == 200
    # Exercise provider validation, not a stub returning invalid bytes after validation.
    monkeypatch.setattr(content, "request_bytes", lambda *args: bad)
    assert c.post(routes(sid) + "/audio", json={"script": script}).status_code == 422
    assert not c.get("/api/live/current").json()["session"]["hostAudioReady"]
    assert (
        c.post(f"/api/admin/live/{sid}/host/acquire", json={"clientId": "no-fallback-client"}).status_code
        == 409
    )


def test_busy_end_during_tts_and_no_blocking_live_lock(prepared, monkeypatch):
    c, sid, _, pcm, _ = prepared
    script = SCRIPT
    assert c.put(routes(sid) + "/script", json={"script": script}).status_code == 200
    entered, release = Event(), Event()

    def delayed(*args):
        entered.set()
        assert release.wait(5)
        return pcm

    monkeypatch.setattr(content_router, "create_audio", delayed)
    with ThreadPoolExecutor() as pool:
        work = pool.submit(c.post, routes(sid) + "/audio", json={"script": script})
        try:
            assert entered.wait(3)
            assert c.get("/api/live/current").status_code == 200
            assert c.post(routes(sid) + "/audio", json={"script": script}).status_code == 409
            assert c.post(f"/api/admin/live/{sid}/end").status_code == 200
        finally:
            release.set()
        assert work.result().status_code == 409
    assert c.get(routes(sid)).json()["durationSeconds"] is None
    assert c.get(routes(sid)).json()["status"] == "script_ready"


def test_product_validation_and_snapshot_stays_with_received_sku():
    p2 = {**PRODUCT, "sku": "BT-XIKE-01", "name": "Other product"}
    live = LiveService()
    session = live.create_session(
        LiveSessionCreate(title="Products", scheduledSkus=["KG-LC-250", "BT-XIKE-01"], products=[PRODUCT, p2])
    )
    live.start_session(session.live_id)
    question = live.submit_question(
        session.live_id,
        LiveQuestionIn(questionId="snapshot-product-001", sessionId="snapshot-viewer-001", text="Question"),
    )
    live.pin_sku(session.live_id, "BT-XIKE-01")
    assert question.product is None  # Narration input is never answer evidence.
    payload = make_bridge.build_make_payload(live.claim_next_question(session.live_id), 7.5)
    assert payload["current_live_sku"] == PRODUCT["sku"]
    assert "product" not in payload  # Bound from the DB by dispatch, not admission.
    with pytest.raises(ValueError):
        LiveSessionCreate(title="Wrong", scheduledSkus=["BT-XIKE-01"], products=[PRODUCT])
    with pytest.raises(ValueError):
        LiveSessionCreate(title="Duplicate", scheduledSkus=["KG-LC-250"], products=[PRODUCT, PRODUCT])


def test_auth_csrf_missing_config_and_no_automatic_calls(prepared):
    c, sid, cfg, _, requests = prepared
    c.headers.pop("X-CSRF-Token")
    assert c.put(routes(sid) + "/script", json={"script": SCRIPT}).status_code == 403
    csrf = c.get("/api/admin/auth/me").json()["csrf"]
    c.headers["X-CSRF-Token"] = csrf
    cfg.elevenlabs_key = SecretStr("")
    assert c.put(routes(sid) + "/script", json={"script": SCRIPT}).status_code == 200
    assert c.post(routes(sid) + "/audio", json={"script": SCRIPT}).status_code == 503
    assert c.get(routes(sid)).json()["status"] == "script_ready"
    assert not requests
    c.cookies.clear()
    assert c.get(routes(sid)).status_code == 401


@pytest.mark.parametrize(
    "failure,expected", [(302, 502), (429, 502), ("timeout", 504), ("wrong_type", 502), ("too_big", 422)]
)
def test_provider_transport_bounded_no_redirect_or_retry(monkeypatch, failure, expected):
    original = httpx.Client
    calls = []

    def handler(request):
        calls.append(request)
        if failure == "timeout":
            raise httpx.ReadTimeout("fake timeout", request=request)
        if failure == "wrong_type":
            return httpx.Response(200, text="not-json")
        if failure == "too_big":
            return httpx.Response(200, content=b"a" * 20, headers={"content-type": "application/json"})
        return httpx.Response(failure, headers={"location": "https://never-follow.invalid"})

    monkeypatch.setattr(
        content.httpx, "Client", lambda **kw: original(transport=httpx.MockTransport(handler), **kw)
    )
    from app.core.errors import AppError

    with pytest.raises(AppError) as error:
        content.request_bytes(
            "https://api.elevenlabs.io/v1/text-to-speech/fake-voice", {}, {}, 10, ("application/json",)
        )
    assert error.value.status_code == expected
    assert len(calls) == 1


@pytest.mark.parametrize("channels,width,rate", [(2, 2, 16000), (1, 1, 16000), (1, 2, 22050)])
def test_tts_wrong_format_rejected(prepared, monkeypatch, channels, width, rate):
    c, sid, _, _, _ = prepared
    script = SCRIPT
    assert c.put(routes(sid) + "/script", json={"script": script}).status_code == 200
    file = io.BytesIO()
    with wave.open(file, "wb") as audio:
        audio.setparams((channels, width, rate, 0, "NONE", "not compressed"))
        audio.writeframes(b"\x10" * (rate * channels * width))
    monkeypatch.setattr(content, "request_bytes", lambda *args: file.getvalue())
    assert c.post(routes(sid) + "/audio", json={"script": script}).status_code == 422
    assert c.get(routes(sid)).json()["status"] == "script_ready"


@pytest.mark.parametrize(
    "status,code,kind",
    [
        (401, "invalid_api_key", "invalid_request_error"),
        (429, "insufficient_quota", "insufficient_quota"),
        (429, "rate_limit_exceeded", "rate_limit_error"),
        (404, "model_not_found", "invalid_request_error"),
        (400, "unsupported_parameter", "invalid_request_error"),
    ],
)
def test_provider_failure_logs_only_safe_metadata(monkeypatch, caplog, status, code, kind):
    from app.core.errors import AppError

    original = httpx.Client
    calls = []
    sensitive = "sk-secret-never-log-this-product-or-key"

    def handle(request):
        calls.append(request)
        return httpx.Response(
            status,
            json={"error": {"code": code, "type": kind, "message": sensitive}},
            headers={"x-request-id": "req_test123", "authorization": sensitive},
        )

    monkeypatch.setattr(
        content.httpx, "Client", lambda **kw: original(transport=httpx.MockTransport(handle), **kw)
    )
    caplog.set_level("WARNING", logger="app.modules.live.content")
    with pytest.raises(AppError) as failure:
        content.request_bytes(
            "https://api.elevenlabs.io/v1/text-to-speech/fake-voice",
            {"Authorization": sensitive},
            {"input": sensitive},
            128000,
            ("application/json",),
        )
    assert failure.value.code == "live_content_provider_error"
    assert failure.value.status_code == 502
    assert len(calls) == 1
    assert f"status={status}" in caplog.text
    assert f"code={code}" in caplog.text
    assert f"type={kind}" in caplog.text
    assert "request_id=req_test123" in caplog.text
    assert sensitive not in caplog.text and sensitive not in str(failure.value)


@pytest.mark.parametrize("mode", ["oversized", "broken", "non_object", "unsafe_fields"])
def test_provider_failure_diagnostic_is_bounded_and_does_not_mask_failure(monkeypatch, caplog, mode):
    from app.core.errors import AppError

    original = httpx.Client
    chunks = []
    sensitive = "sk-secret-never-log-this"

    class Body(httpx.SyncByteStream):
        def __iter__(self):
            if mode == "broken":
                raise httpx.ReadError("not logged: " + sensitive)
            if mode == "oversized":
                for _ in range(1000):
                    chunks.append(1024)
                    yield b"a" * 1024
            elif mode == "non_object":
                yield b"[]"
            else:
                yield json.dumps(
                    {"error": {"code": sensitive, "type": sensitive, "message": sensitive}}
                ).encode()

    def handle(request):
        return httpx.Response(429, stream=Body(), headers={"x-request-id": sensitive})

    monkeypatch.setattr(
        content.httpx, "Client", lambda **kw: original(transport=httpx.MockTransport(handle), **kw)
    )
    caplog.set_level("WARNING", logger="app.modules.live.content")
    with pytest.raises(AppError) as failure:
        content.request_bytes(
            "https://api.elevenlabs.io/v1/text-to-speech/fake-voice", {}, {}, 128000, ("application/json",)
        )
    assert failure.value.code == "live_content_provider_error"
    assert "status=429" in caplog.text
    assert sensitive not in caplog.text
    assert len(chunks) <= 9


def test_manual_script_review_audio_edit_invalidates_and_preserves_product(prepared):
    c, sid, cfg, pcm, requests = prepared
    base = routes(sid)
    assert cfg.audio_configured
    assert c.put(base + "/script", json={"script": SCRIPT}).json()["script"] == SCRIPT
    assert not requests
    assert c.get(base).json()["product"] == PRODUCT
    cid = {"clientId": "manual-client"}
    assert c.post(f"/api/admin/live/{sid}/host/acquire", json=cid).status_code == 409
    assert c.post(base + "/audio", json={"script": "not reviewed"}).status_code == 409
    assert not requests
    assert c.post(base + "/audio", json={"script": SCRIPT}).status_code == 200
    assert len(requests) == 1 and requests[0].url.host == "api.elevenlabs.io"
    assert json.loads(requests[0].content)["text"] == SCRIPT
    assert c.put(base + "/script", json={"script": SCRIPT}).json()["status"] == "ready"
    edited = SCRIPT + " Nội dung mới đã duyệt."
    saved = c.put(base + "/script", json={"script": edited}).json()
    assert saved["status"] == "script_ready" and saved["durationSeconds"] is None
    current = c.get("/api/live/current").json()["session"]
    assert not current["hostAudioReady"] and current["hostAudioDurationSeconds"] is None
    assert current["products"] == [PRODUCT]
    assert c.post(f"/api/admin/live/{sid}/host/acquire", json=cid).status_code == 409
    assert c.post(base + "/audio", json={"script": SCRIPT}).status_code == 409
    assert len(requests) == 1
    assert c.post(base + "/audio", json={"script": edited}).status_code == 200
    assert len(requests) == 2 and json.loads(requests[-1].content)["text"] == edited
    lease = c.post(f"/api/admin/live/{sid}/host/acquire", json=cid)
    assert lease.status_code == 200
    c.headers["X-Live-Host-Lease"] = lease.json()["leaseId"]
    assert c.post(f"/api/admin/live/{sid}/host/token", json=cid).status_code == 200
    assert (
        c.post(
            f"/api/admin/live/{sid}/host/action", json={**cid, "requestId": "manual-ready", "action": "ready"}
        ).status_code
        == 200
    )
    assert c.put(base + "/script", json={"script": SCRIPT}).status_code == 409
    assert c.get(base).json()["script"] == edited
    assert c.post(f"/api/admin/live/{sid}/host/audio", json=cid).content == pcm


def test_manual_clear_invalidates_audio_and_auth_validation(prepared):
    c, sid, _, _, requests = prepared
    base = routes(sid)
    assert c.put(base + "/script", json={"script": SCRIPT}).status_code == 200
    assert c.post(base + "/audio", json={"script": SCRIPT}).status_code == 200
    assert c.put(base + "/script", json={"script": "  \n\t"}).json()["status"] == "empty"
    assert c.get(base).json()["durationSeconds"] is None
    assert not c.get("/api/live/current").json()["session"]["hostAudioReady"]
    for invalid in (
        {"script": "a" * 2001},
        {"script": None},
        {"script": True},
        {"script": SCRIPT, "product": PRODUCT},
    ):
        assert c.put(base + "/script", json=invalid).status_code == 422
    assert len(requests) == 1
    c.headers.pop("X-CSRF-Token")
    assert c.put(base + "/script", json={"script": SCRIPT}).status_code == 403
    c.cookies.clear()
    assert c.put(base + "/script", json={"script": SCRIPT}).status_code in (401, 403)


def test_manual_edit_during_tts_rejected_without_stale_audio(prepared, monkeypatch):
    c, sid, _, pcm, _ = prepared
    base = routes(sid)
    c.put(base + "/script", json={"script": SCRIPT})
    entered, release = Event(), Event()

    def delayed(script, config):
        assert script == SCRIPT
        entered.set()
        assert release.wait(5)
        return pcm

    monkeypatch.setattr(content_router, "create_audio", delayed)
    with ThreadPoolExecutor() as pool:
        work = pool.submit(c.post, base + "/audio", json={"script": SCRIPT})
        try:
            assert entered.wait(3)
            assert c.put(base + "/script", json={"script": "Changed"}).status_code == 409
            assert c.get(base).json()["script"] == SCRIPT
        finally:
            release.set()
        assert work.result().status_code == 200
    assert c.get(base).json()["status"] == "ready"


@pytest.mark.parametrize(
    "detail,expected_code,expected_type",
    [
        ({"status": "voice_not_found"}, "voice_not_found", "other"),
        ({"status": "invalid_model_id"}, "invalid_model_id", "other"),
        (
            {"code": "invalid_output_format", "type": "validation_error"},
            "invalid_output_format",
            "validation_error",
        ),
        (
            {"code": "invalid_language_code", "type": "validation_error"},
            "invalid_language_code",
            "validation_error",
        ),
        ({"status": "quota_exceeded"}, "quota_exceeded", "other"),
        (
            {"code": "quota_exceeded", "status": "legacy_other", "type": "payment_required"},
            "quota_exceeded",
            "payment_required",
        ),
        (
            {"status": "sk-secret-not-a-valid-error-code", "type": "sk-secret-not-a-valid-error-code"},
            "other",
            "other",
        ),
    ],
)
def test_elevenlabs_detail_error_metadata_without_leaking_data(
    monkeypatch, caplog, detail, expected_code, expected_type
):
    from app.core.errors import AppError

    original = httpx.Client
    calls = []
    secret = "sk-secret-not-a-valid-error-code"

    def handle(request):
        calls.append(request)
        return httpx.Response(400, json={"detail": {**detail, "message": secret, "input": secret}})

    monkeypatch.setattr(
        content.httpx, "Client", lambda **kw: original(transport=httpx.MockTransport(handle), **kw)
    )
    caplog.set_level("WARNING", logger="app.modules.live.content")
    with pytest.raises(AppError) as error:
        content.request_bytes(
            "https://api.elevenlabs.io/v1/text-to-speech/fake-voice?output_format=wav_16000",
            {"xi-api-key": secret},
            {"text": secret},
            10000,
            ("audio/wav",),
        )
    assert error.value.code == "live_content_provider_error"
    assert error.value.status_code == 502
    assert len(calls) == 1
    assert f"code={expected_code}" in caplog.text
    assert f"type={expected_type}" in caplog.text
    assert secret not in caplog.text and secret not in str(error.value)
