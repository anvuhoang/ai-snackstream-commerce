"""Portable setup and two independent operators; no private fixture or provider is used."""

import io
import json
import math
import os
import struct
import wave
from datetime import UTC, datetime, timedelta

import httpx
import pytest
from fastapi.testclient import TestClient

from app import cli
from app.core.config import Settings, get_settings
from app.main import create_app
from app.modules.live import content, make_bridge, simli_host
from app.modules.live import service as live_clock
from app.modules.live.content import ContentSettings, get_content_settings

TOKEN = "operations-callback-test-" + "x" * 32
SCRIPT = "Xin chào, đây là lời dẫn đã duyệt. Hãy gửi câu hỏi về sản phẩm đang giới thiệu."
PRODUCT = {"sku": "KG-LC-250", "name": "Narration input", "facts": "Narration facts are not answer data."}


@pytest.fixture
def portable_env(tmp_path, monkeypatch):
    # An ordinary checkout's .env, not an application-specific launcher or copied credential.
    for name in tuple(os.environ):
        if name.startswith(("LIVE_", "ELEVENLABS_", "BOOTSTRAP_", "ODOO_", "PAYOS_")) or name in {
            "APP_ENV",
            "DATABASE_URL",
            "SECRET_KEY",
            "MEDIA_DIR",
            "RUN_MIGRATIONS_ON_START",
        }:
            monkeypatch.delenv(name)
    monkeypatch.chdir(tmp_path)
    values = {
        "APP_ENV": "test",
        "DATABASE_URL": f"sqlite:///{(tmp_path / 'shop.sqlite').as_posix()}",
        "SECRET_KEY": "operations-test-cookie-secret",
        "MEDIA_DIR": (tmp_path / "media").as_posix(),
        "LIVE_SIMLI_ENABLED": "true",
        "LIVE_SIMLI_TRANSPORT": "mock",
        "LIVE_CONTENT_ENABLED": "true",
        "LIVE_SIMLI_REPLY_AUDIO_ENABLED": "true",
        "ELEVENLABS_API_KEY": "fake-operations-tts",
        "ELEVENLABS_VOICE_ID": "fake-voice",
        "ELEVENLABS_MODEL_ID": "fake-model",
        "LIVE_MAKE_ENABLED": "true",
        "LIVE_MOCK_ENABLED": "false",
        "LIVE_MAKE_WEBHOOK_URL": "https://make.example.invalid/no-network",
        "LIVE_MAKE_CALLBACK_TOKEN": TOKEN,
        "LIVE_FFPROBE_PATH": "missing-ffprobe-is-not-needed-for-audio",
    }
    (tmp_path / ".env").write_text("\n".join(f"{k}={v}" for k, v in values.items()), encoding="utf-8")
    get_settings.cache_clear()
    get_content_settings.cache_clear()
    yield tmp_path
    get_settings.cache_clear()
    get_content_settings.cache_clear()


def test_normal_dotenv_configures_content_without_private_launcher(portable_env):
    common, audio = Settings(), get_content_settings()
    assert common.live_simli_enabled and common.live_make_enabled and not common.live_mock_enabled
    assert audio.enabled and audio.reply_audio_enabled and audio.audio_configured
    assert audio.voice_id == "fake-voice"
    assert not common.live_simli_audio_path and not audio.mock_reply_wav_path
    assert "fake-operations-tts" not in repr(audio)


def test_process_environment_overrides_dotenv_and_explicit_opt_out(portable_env, monkeypatch):
    monkeypatch.setenv("LIVE_CONTENT_ENABLED", "false")
    monkeypatch.setenv("ELEVENLABS_VOICE_ID", "environment-voice")
    assert ContentSettings().enabled is False
    assert ContentSettings().voice_id == "environment-voice"
    assert ContentSettings(_env_file=None).elevenlabs_key.get_secret_value() == ""


def test_documented_offline_mode_needs_no_credentials_or_ffprobe(portable_env, monkeypatch):
    pcm = b"".join(
        struct.pack("<h", round(4000 * math.sin(2 * math.pi * 220 * i / 16000))) for i in range(16000 * 10)
    )
    narration, reply = portable_env / "narration.pcm", portable_env / "reply.wav"
    narration.write_bytes(pcm)
    with wave.open(str(reply), "wb") as wav:
        wav.setparams((1, 2, 16000, 0, "NONE", "not compressed"))
        wav.writeframes(pcm[: 32000 * 3])
    config_file = portable_env / ".env"
    values = dict(line.split("=", 1) for line in config_file.read_text(encoding="utf-8").splitlines())
    values.update(
        LIVE_CONTENT_ENABLED="false",
        LIVE_MAKE_ENABLED="false",
        LIVE_MOCK_ENABLED="true",
        LIVE_MAKE_WEBHOOK_URL="",
        LIVE_MAKE_CALLBACK_TOKEN="",
        LIVE_SIMLI_API_KEY="",
        ELEVENLABS_API_KEY="",
        ELEVENLABS_VOICE_ID="",
        ELEVENLABS_MODEL_ID="",
        LIVE_SIMLI_AUDIO_SKU="KG-LC-250",
        LIVE_SIMLI_AUDIO_PATH=narration.as_posix(),
        LIVE_SIMLI_MOCK_REPLY_WAV_PATH=reply.as_posix(),
    )
    config_file.write_text("\n".join(f"{k}={v}" for k, v in values.items()), encoding="utf-8")

    def forbidden(*args, **kwargs):
        pytest.fail("Offline operation must not contact providers or generate TTS")

    monkeypatch.setattr(make_bridge, "urlopen", forbidden)
    monkeypatch.setattr(httpx.HTTPTransport, "handle_request", forbidden)
    monkeypatch.setattr(content, "create_audio", forbidden)
    monkeypatch.setattr(cli.getpass, "getpass", lambda _: "offline-operator-password")
    assert cli.main(["create-admin", "offline@example.invalid"]) == 0
    assert cli.main(["seed-catalog"]) == 0
    assert not get_content_settings().audio_configured
    with TestClient(create_app(get_settings())) as admin:
        assert admin.get("/api/readyz").json() == {"ok": True, "database": "up"}
        login = admin.post(
            "/api/admin/auth/login",
            json={"email": "offline@example.invalid", "password": "offline-operator-password"},
        )
        admin.headers["X-CSRF-Token"] = login.json()["csrf"]
        capabilities = admin.get("/api/admin/live/host-capabilities").json()
        assert capabilities["transport"] == "mock" and not capabilities["contentEnabled"]
        created = admin.post(
            "/api/admin/live",
            json={"title": "Offline setup", "hostMode": "simli", "scheduledSkus": ["KG-LC-250"]},
        )
        assert created.status_code == 201, created.text
        sid = created.json()["liveId"]
        path = f"/api/admin/live/{sid}/host"
        client = {"clientId": "offline-producer-client"}
        acquired = admin.post(path + "/acquire", json=client)
        assert acquired.status_code == 200, acquired.text
        headers = {"X-Live-Host-Lease": acquired.json()["leaseId"]}
        assert admin.post(path + "/token", json=client, headers=headers).json()["transport"] == "mock"
        assert admin.post(path + "/audio", json=client, headers=headers).content == pcm

        def action(event, offset=None, qid=None):
            response = admin.post(
                path + "/action",
                headers=headers,
                json={
                    **client,
                    "action": event,
                    "requestId": f"offline-{event}",
                    "offsetSeconds": offset,
                    "questionId": qid,
                },
            )
            assert response.status_code == 200, response.text
            return response.json()["session"]

        action("ready")
        qid = "offline-question-001"
        question = admin.post(
            f"/api/live/{sid}/questions",
            json={"questionId": qid, "sessionId": "offline-viewer-session", "text": "Một câu hỏi"},
        )
        assert question.status_code == 200
        q = admin.get("/api/live/current").json()["session"]["questions"][0]
        assert q["status"] == "ready" and q["mediaSource"] == "prerecorded"
        assert (
            admin.post(path + f"/reply-audio/{qid}", json=client, headers=headers).content == pcm[: 32000 * 3]
        )
        action("handoff", 2, qid)
        action("reply_playing", None, qid)
        action("reply_ended", None, qid)
        assert action("restored", 1.82, qid)["questions"][0]["status"] == "answered"
        assert action("stop")["status"] == "ended"


def test_two_admin_accounts_use_catalog_tts_reply_restore_and_preserve_owner_guards(
    portable_env,
    monkeypatch,
):
    class Clock(datetime):
        current = datetime.now(UTC)

        @classmethod
        def now(cls, tz=None):
            return cls.current if tz else cls.current.replace(tzinfo=None)

    monkeypatch.setattr(live_clock, "datetime", Clock)
    monkeypatch.setattr(simli_host, "datetime", Clock)
    monkeypatch.setattr(cli.getpass, "getpass", lambda _: "independent-operator-password")
    for email, role in [
        ("operator-one@example.invalid", "admin"),
        ("operator-two@example.invalid", "admin"),
        ("staff@example.invalid", "staff"),
    ]:
        assert cli.main(["create-admin", email, "--role", role]) == 0
    assert cli.main(["seed-catalog"]) == 0
    settings = get_settings()
    tts_texts, payloads = [], []
    pcm = b"".join(
        struct.pack("<h", round(4000 * math.sin(2 * math.pi * 220 * i / 16000))) for i in range(16000 * 10)
    )
    output = io.BytesIO()
    with wave.open(output, "wb") as audio:
        audio.setparams((1, 2, 16000, 0, "NONE", "not compressed"))
        audio.writeframes(pcm)
    wav = output.getvalue()
    real_client = httpx.Client

    def fake_tts(request):
        assert request.url.host == "api.elevenlabs.io"
        assert request.url.params["output_format"] == "wav_16000"
        tts_texts.append(json.loads(request.content)["text"])
        return httpx.Response(200, content=wav, headers={"Content-Type": "audio/wav"})

    monkeypatch.setattr(
        content.httpx, "Client", lambda **kw: real_client(transport=httpx.MockTransport(fake_tts), **kw)
    )

    class Ack:
        status = 202

        def __enter__(self):
            return self

        def __exit__(self, *args):
            return False

    def fake_make(request, **kwargs):
        payloads.append(json.loads(request.data))
        return Ack()

    monkeypatch.setattr(make_bridge, "urlopen", fake_make)
    with TestClient(create_app(settings)) as root:
        app = root.app
        operators = [TestClient(app), TestClient(app)]
        staff, guest = TestClient(app), TestClient(app)
        for c, email in zip(
            operators + [staff],
            ["operator-one@example.invalid", "operator-two@example.invalid", "staff@example.invalid"],
            strict=True,
        ):
            login = c.post(
                "/api/admin/auth/login", json={"email": email, "password": "independent-operator-password"}
            )
            assert login.status_code == 200
            c.headers["X-CSRF-Token"] = login.json()["csrf"]
        first, second = operators
        assert (
            first.get("/api/admin/auth/me").json()["user"]["id"]
            != second.get("/api/admin/auth/me").json()["user"]["id"]
        )
        for index, operator in enumerate(operators):
            if index:
                Clock.current += timedelta(seconds=121)  # Observe the unchanged slot hold; never bypass it.
            created = operator.post(
                "/api/admin/live",
                json={
                    "title": "Independent operator",
                    "hostMode": "simli",
                    "scheduledSkus": ["KG-LC-250"],
                    "products": [PRODUCT],
                },
            )
            assert created.status_code == 201, created.text
            sid = created.json()["liveId"]
            path = f"/api/admin/live/{sid}"
            assert operator.post(path + "/pin", json={"sku": "KG-LC-250"}).status_code == 200
            assert operator.post(path + "/pin", json={"sku": None}).json()["productPinned"] is False
            assert operator.post(path + "/pin", json={"sku": "KG-LC-250"}).status_code == 200
            assert (
                operator.post(
                    path + "/host/acquire", json={"clientId": f"operator-client-{index}"}
                ).status_code
                == 409
            )
            assert operator.put(path + "/content/script", json={"script": SCRIPT}).status_code == 200
            assert (
                operator.post(path + "/content/audio", json={"script": SCRIPT}).json()["durationSeconds"]
                == 10
            )
            client_id = f"operator-client-{index}"
            acquired = operator.post(path + "/host/acquire", json={"clientId": client_id})
            assert acquired.status_code == 200, acquired.text
            lease = {"X-Live-Host-Lease": acquired.json()["leaseId"]}
            if not index:
                assert (
                    second.post(
                        path + "/host/acquire", json={"clientId": "second-producer-client"}
                    ).status_code
                    == 409
                )
                assert (
                    second.post(path + "/host/token", json={"clientId": client_id}, headers=lease).status_code
                    == 403
                )
                assert (
                    second.post(path + "/host/audio", json={"clientId": client_id}, headers=lease).status_code
                    == 403
                )
                assert (
                    second.put(
                        path + "/content/script", json={"script": "Cannot edit active host"}
                    ).status_code
                    == 409
                )
                assert (
                    staff.post(path + "/host/acquire", json={"clientId": "staff-client-001"}).status_code
                    == 403
                )
                assert (
                    guest.post(path + "/host/acquire", json={"clientId": "guest-client-001"}).status_code
                    == 401
                )
                assert (
                    operator.post(
                        path + "/host/token",
                        json={"clientId": client_id},
                        headers={**lease, "X-CSRF-Token": "wrong"},
                    ).status_code
                    == 403
                )
            token = operator.post(path + "/host/token", json={"clientId": client_id}, headers=lease)
            assert token.json() == {"transport": "mock", "sessionToken": "mock-local-transport"}
            seq = 0

            def action(
                event,
                offset=None,
                qid=None,
                *,
                actor=operator,
                path=path,
                lease=lease,
                client_id=client_id,
                index=index,
            ):
                nonlocal seq
                seq += 1
                return actor.post(
                    path + "/host/action",
                    headers=lease,
                    json={
                        "clientId": client_id,
                        "requestId": f"operator-command-{index}-{seq}",
                        "action": event,
                        "offsetSeconds": offset,
                        "questionId": qid,
                    },
                )

            if not index:
                assert action("heartbeat", actor=second).status_code == 403
            assert action("ready").status_code == 200
            qid = f"operator-question-{index}"
            assert (
                guest.post(
                    f"/api/live/{sid}/questions",
                    json={"questionId": qid, "sessionId": "independent-viewer", "text": "Giá gói 250 g?"},
                ).status_code
                == 200
            )
            payload = payloads[-1]
            assert payload["product"]["sku"] == payload["current_live_sku"] == "KG-LC-250"
            assert "55000" in payload["product"]["facts"]
            assert "Narration facts" not in payload["product"]["facts"]
            answer = "Giá trong database là 55.000 đồng cho gói 250 g."
            callback = guest.post(
                "/api/live/make-answer",
                headers={"X-Live-Make-Token": TOKEN},
                json={"liveId": sid, "questionId": qid, "sku": "KG-LC-250", "replyText": answer},
            )
            assert callback.json()["reason"] == "processing"
            assert (
                operator.post(
                    path + f"/host/reply-audio/{qid}", headers=lease, json={"clientId": client_id}
                ).content
                == pcm
            )
            assert action("handoff", 2, qid).status_code == 200
            assert action("reply_playing", None, qid).status_code == 200
            assert action("reply_ended", None, qid).status_code == 200
            assert action("restored", 1.82, qid).status_code == 200
            current = guest.get("/api/live/current").json()["session"]
            assert current["questions"][0]["status"] == "answered"
            assert current["host"]["phase"] == "script"
            assert action("stop").json()["session"]["status"] == "ended"
            if not index:
                blocked = second.post(
                    "/api/admin/live",
                    json={
                        "title": "Wait for slot",
                        "hostMode": "simli",
                        "scheduledSkus": ["KG-LC-250"],
                        "products": [PRODUCT],
                    },
                )
                assert blocked.status_code == 201
                wait_sid = blocked.json()["liveId"]
                second.put(f"/api/admin/live/{wait_sid}/content/script", json={"script": SCRIPT})
                second.post(f"/api/admin/live/{wait_sid}/content/audio", json={"script": SCRIPT})
                assert (
                    second.post(
                        f"/api/admin/live/{wait_sid}/host/acquire", json={"clientId": "waiting-producer-001"}
                    ).status_code
                    == 409
                )
                assert second.post(f"/api/admin/live/{wait_sid}/end").status_code == 200
        assert tts_texts.count(SCRIPT) == 3 and len(payloads) == 2
        assert tts_texts.count("Giá trong database là 55.000 đồng cho gói 250 g.") == 2
