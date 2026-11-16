from datetime import UTC, datetime, timedelta

import pytest
from fastapi.testclient import TestClient

from app.modules.live import service as service_module
from app.modules.live import simli_host
from app.modules.live.schemas import LiveQuestionIn


@pytest.fixture
def host(client, tmp_path, monkeypatch):
    class Clock(datetime):
        current = datetime.now(UTC)

        @classmethod
        def now(cls, tz=None):
            return cls.current if tz else cls.current.replace(tzinfo=None)

    monkeypatch.setattr(service_module, "datetime", Clock)
    monkeypatch.setattr(simli_host, "datetime", Clock)
    settings = client.app.state.settings
    settings.live_simli_enabled = True
    path = tmp_path / "host.pcm"
    path.write_bytes(b"\x10\x00" * 16000 * 43)
    settings.live_simli_audio_path = str(path)
    settings.live_simli_audio_sku = "KG-LC-250"
    client.post(
        "/api/admin/auth/login", json={"email": "admin@example.com", "password": "correct-horse-battery"}
    )
    csrf = client.get("/api/admin/auth/me").json()["csrf"]
    client.headers["X-CSRF-Token"] = csrf
    created = client.post(
        "/api/admin/live", json={"title": "Simli opt-in", "scheduledSkus": ["KG-LC-250"], "hostMode": "simli"}
    )
    assert created.status_code == 201, created.text
    sid = created.json()["liveId"]
    cid = "producer-client-001"
    acquired = client.post(f"/api/admin/live/{sid}/host/acquire", json={"clientId": cid})
    assert acquired.status_code == 200, acquired.text
    lease = acquired.json()["leaseId"]
    headers = {"X-Live-Host-Lease": lease}
    sequence = [0]

    def action(event, qid=None, offset=None, request_id=None):
        sequence[0] += 1
        return client.post(
            f"/api/admin/live/{sid}/host/action",
            headers=headers,
            json={
                "clientId": cid,
                "requestId": request_id or f"host-command-{sequence[0]:05d}",
                "action": event,
                "questionId": qid,
                "offsetSeconds": offset,
            },
        )

    def token():
        return client.post(f"/api/admin/live/{sid}/host/token", headers=headers, json={"clientId": cid})

    def ready(qid="simli-question-001"):
        live = client.app.state.live
        if live.get_current().status == "not_started":
            assert token().status_code == 200
            assert action("ready").status_code == 200
        q = live.submit_question(
            sid, LiveQuestionIn(questionId=qid, sessionId="viewer-session-001", text="A mock question")
        )
        assert q.sku == "KG-LC-250"
        live.claim_next_question(sid)
        live.complete_mock_question(sid, qid, 5.108005)
        return qid

    return client, sid, cid, lease, action, token, ready, Clock


def test_disabled_mode_and_legacy_unchanged(client):
    login = client.post(
        "/api/admin/auth/login", json={"email": "admin@example.com", "password": "correct-horse-battery"}
    )
    client.headers["X-CSRF-Token"] = login.json()["csrf"]
    body = {"title": "Legacy", "scheduledSkus": ["KG-LC-250"]}
    assert client.post("/api/admin/live", json={**body, "hostMode": "simli"}).status_code == 409
    created = client.post("/api/admin/live", json=body).json()
    assert created["hostMode"] == "video"
    assert client.post(f"/api/admin/live/{created['liveId']}/start").status_code == 200


def test_ready_clock_and_startup_lease(host):
    client, sid, _, lease, action, token, _, clock = host
    for _ in range(2):
        clock.current += timedelta(seconds=4)
        assert action("heartbeat").status_code == 200
    state = client.get("/api/live/current").json()["session"]
    assert state["status"] == "not_started" and state["playback"] is None
    assert lease not in client.get("/api/live/current").text
    assert token().json()["transport"] == "mock"
    assert token().status_code == 409
    assert action("ready").json()["session"]["status"] == "playing"
    assert client.post(f"/api/admin/live/{sid}/start").status_code == 409


def test_queue_restore_duplicate_and_correct_slot(host):
    client, sid, _, _, action, _, ready, clock = host
    q = ready()
    live = client.app.state.live
    assert not live.start_ready_reply(sid)
    assert action("handoff", q, 6.926, "same-handoff-001").status_code == 200
    assert action("handoff", q, 6.926, "same-handoff-001").status_code == 200
    assert action("handoff", q, 7, "same-handoff-001").status_code == 409
    assert action("reply_playing", q).status_code == 200
    for _ in range(3):
        clock.current += timedelta(seconds=4)
        assert action("heartbeat").status_code == 200
        assert not live.finish_reply(sid)
    ready_body = LiveQuestionIn(questionId="simli-question-002", sessionId="viewer-session-002", text="next")
    live.submit_question(sid, ready_body)
    assert live.submit_question(sid, ready_body).question_id == "simli-question-002"
    assert live.claim_next_question(sid) is None
    assert client.post(f"/api/admin/live/{sid}/questions/{q}/skip").status_code == 200
    assert live.claim_next_question(sid).question_id == "simli-question-002"
    assert action("reply_ended", q).status_code == 200
    assert action("restored", q, 6.1).status_code == 409
    assert action("restored", q, 6.746).status_code == 200
    assert live._active_question_id == "simli-question-002"
    assert action("restored", q, 6.746).status_code == 409


@pytest.mark.parametrize("seconds", [6, 7, 90])
def test_expiry_without_viewer_and_late_feedback(host, seconds):
    client, _, _, _, action, _, _, clock = host
    clock.current += timedelta(seconds=seconds)
    assert action("heartbeat").status_code == 409
    assert client.get("/api/live/current").json()["session"]["status"] == "ended"


def test_prepare_timeout_and_absolute_cap(host):
    client, _, _, _, action, _, _, clock = host
    for _ in range(4):
        clock.current += timedelta(seconds=4)
        assert action("heartbeat").status_code == 200
    clock.current += timedelta(seconds=4)
    assert action("heartbeat").status_code == 409


def test_end_late_events_and_answered_duplicate(host):
    client, sid, _, _, action, _, ready, _ = host
    q = ready()
    assert action("handoff", q, 3).status_code == 200
    assert action("reply_ended", q).status_code == 200
    assert action("restored", q, 2.8).status_code == 200
    assert action("restored", q, 2.8).status_code == 200
    assert action("handoff", q, 3).status_code == 409
    assert client.post(f"/api/admin/live/{sid}/end").status_code == 200
    for event in ("handoff", "reply_playing", "reply_ended", "restored", "ready"):
        assert action(event, q, 3).status_code == 409


def test_public_viewer_role_and_signaling(host):
    client, sid, cid, lease, action, token, _, _ = host
    assert token().status_code == 200
    assert action("ready").status_code == 200
    viewer = TestClient(client.app)
    for endpoint in ("acquire", "action", "token", "audio", "offer"):
        assert (
            viewer.post(
                f"/api/admin/live/{sid}/host/{endpoint}",
                json={"clientId": cid},
                headers={"X-Live-Host-Lease": lease},
            ).status_code
            == 401
        )
    registered = viewer.post(f"/api/live/{sid}/host/viewers", json={"clientId": "viewer-client-001"}).json()
    key = {"X-Live-Viewer-Key": registered["viewerKey"]}
    base = f"/api/live/{sid}/host/viewers/viewer-client-001"
    assert viewer.get(base).status_code == 422
    assert viewer.get(base, headers={"X-Live-Viewer-Key": "wrong-key"}).status_code == 403
    assert viewer.get(base, headers=key).status_code == 200
    offer = {
        "clientId": cid,
        "viewerId": "viewer-client-001",
        "offerId": "offer-test-001",
        "sdp": "synthetic SDP",
    }
    path = f"/api/admin/live/{sid}/host/offer"
    assert client.post(path, json=offer, headers={"X-Live-Host-Lease": "wrong"}).status_code == 403
    assert client.post(path, json=offer, headers={"X-Live-Host-Lease": lease}).status_code == 204
    assert client.post(path, json=offer, headers={"X-Live-Host-Lease": lease}).status_code == 204
    answer = {"offerId": "offer-test-001", "sdp": "synthetic answer"}
    assert viewer.post(base + "/answer", headers=key, json=answer).status_code == 204
    assert viewer.post(base + "/answer", headers=key, json=answer).status_code == 204
    assert viewer.post(base + "/answer", headers=key, json={**answer, "sdp": "conflict"}).status_code == 409
    assert viewer.post(base + "/leave", headers=key).status_code == 204
    assert viewer.get(base, headers=key).status_code == 403


def test_eof_drains_reply_then_bounded_tail(host):
    client, _, _, _, action, _, ready, clock = host
    q = ready()
    assert action("audio_ended").status_code == 200
    assert action("handoff", q, 43).status_code == 200
    assert action("reply_ended", q).status_code == 200
    assert action("restored", q, 43).status_code == 200
    assert client.get("/api/live/current").json()["session"]["status"] == "playing"
    clock.current += timedelta(seconds=0.75)
    assert client.get("/api/live/current").json()["session"]["status"] == "ended"


def test_sdp_wire_format_survives_models():
    from app.modules.live.schemas import (
        LiveHostAnswerIn,
        LiveHostOfferIn,
        LiveHostPeerOut,
        LiveHostViewerStateOut,
    )

    wire = "v=0\r\ns=unit-test\r\n"
    assert (
        LiveHostOfferIn(clientId="producer-001", viewerId="viewer-001", offerId="offer-001", sdp=wire).sdp
        == wire
    )
    assert LiveHostAnswerIn(offerId="offer-001", sdp=wire).sdp == wire
    assert LiveHostPeerOut(viewerId="viewer-001", answer=wire).answer == wire
    assert LiveHostViewerStateOut(epoch="test", phase="script", offer=wire).offer == wire


def test_late_token_cannot_end_new_session(host, monkeypatch):
    client, sid, _, _, _, token, _, _ = host
    live = client.app.state.live
    from app.modules.live.schemas import LiveSessionCreate

    def delayed_result(_settings):
        live.end_session(sid)
        live.create_session(
            LiveSessionCreate(title="Next session", scheduledSkus=["KG-LC-250"], hostMode="simli")
        )
        return "synthetic-late-token"

    monkeypatch.setattr("app.modules.live.host_router.session_token", delayed_result)
    assert token().status_code == 404
    assert live.get_current().status == "not_started"
    assert live.get_current().live_id != sid


def test_slot_held_across_new_session_and_wrong_lease(host):
    client, sid, cid, lease, _, _, _, clock = host
    assert client.post(f"/api/admin/live/{sid}/end").status_code == 200
    new = client.post(
        "/api/admin/live", json={"title": "Next", "scheduledSkus": ["KG-LC-250"], "hostMode": "simli"}
    ).json()
    path = f"/api/admin/live/{new['liveId']}/host/acquire"
    assert client.post(path, json={"clientId": cid}).status_code == 409
    clock.current += timedelta(seconds=120)
    assert client.post(path, json={"clientId": cid}).status_code == 200
    r = client.post(
        f"/api/admin/live/{new['liveId']}/host/action",
        headers={"X-Live-Host-Lease": lease},
        json={"clientId": cid, "requestId": "stale-command-001", "action": "heartbeat"},
    )
    assert r.status_code == 403
    assert client.app.state.live.get_current().status == "not_started"


def test_staff_cannot_control_producer(host):
    client, sid, cid, lease, _, _, _, _ = host
    from sqlalchemy import select

    from app.modules.auth.models import AdminUser

    with client.app.state.session_factory() as db:
        user = db.scalar(select(AdminUser))
        user.role = "staff"
        db.commit()
    for name in ("acquire", "audio", "token", "action", "offer"):
        r = client.post(
            f"/api/admin/live/{sid}/host/{name}", json={"clientId": cid}, headers={"X-Live-Host-Lease": lease}
        )
        assert r.status_code == 403


def test_csrf_and_invalid_audio_do_not_start_host(host):
    client, sid, cid, lease, _, _, _, _ = host
    r = client.post(
        f"/api/admin/live/{sid}/host/token",
        json={"clientId": cid},
        headers={"X-Live-Host-Lease": lease, "X-CSRF-Token": "invalid"},
    )
    assert r.status_code == 403
    assert not client.app.state.live._simli_host.token_requested
    client.app.state.settings.live_simli_audio_path = ""
    assert (
        client.post(
            f"/api/admin/live/{sid}/host/audio", json={"clientId": cid}, headers={"X-Live-Host-Lease": lease}
        ).status_code
        == 503
    )


def test_token_contract_uses_fixed_framing_with_fake_http(settings, monkeypatch):
    from pydantic import SecretStr

    from app.modules.live.host_media import FACE_ID, session_token

    settings.live_simli_enabled = True
    settings.live_simli_transport = "simli"
    settings.live_simli_api_key = SecretStr("synthetic-test-key-not-live")
    calls = []

    class FakeClient:
        def __init__(self, **options):
            assert options == {"timeout": 8, "follow_redirects": False}

        def __enter__(self):
            return self

        def __exit__(self, *args):
            return None

        def post(self, url, **kwargs):
            calls.append((url, kwargs))

            class Result:
                status_code = 200

                def json(self):
                    return {"session_token": "synthetic-session-token"}

            return Result()

    monkeypatch.setattr("app.modules.live.host_media.httpx.Client", FakeClient)
    assert session_token(settings) == "synthetic-session-token"
    assert len(calls) == 1
    payload = calls[0][1]["json"]
    assert payload["faceId"] == FACE_ID
    assert payload["streaming_width"] == payload["streaming_height"] == 768
    assert payload["maxSessionLength"] == 90
    assert (payload["avatar_position_x"], payload["avatar_position_y"]) == (0.5, 1)
    assert not any("camera" in key for key in payload)


def test_runtime_expires_host_without_viewer_or_api_requests(settings, monkeypatch):
    import time

    from app.main import create_app
    from app.modules.live.schemas import LiveSessionCreate

    class Clock(datetime):
        current = datetime.now(UTC)

        @classmethod
        def now(cls, tz=None):
            return cls.current if tz else cls.current.replace(tzinfo=None)

    monkeypatch.setattr(service_module, "datetime", Clock)
    monkeypatch.setattr(simli_host, "datetime", Clock)
    settings.live_simli_enabled = True
    with TestClient(create_app(settings)) as c:
        live = c.app.state.live
        s = live.create_session(
            LiveSessionCreate(title="Worker expiry", scheduledSkus=["KG-LC-250"], hostMode="simli")
        )
        simli_host.acquire(live, s.live_id, "admin-test", "producer-bg-001", 43, audio_sku="KG-LC-250")
        Clock.current += timedelta(seconds=6)
        time.sleep(0.65)
        assert live._current.status == "ended"


@pytest.mark.parametrize("boundary", ["lease", "cap"])
@pytest.mark.parametrize("delta", [-0.001, 0, 0.001])
def test_question_http_refreshes_expiry_before_accepting_without_tick(host, boundary, delta):
    client, sid, _, _, action, token, _, clock = host
    assert token().status_code == 200
    assert action("ready").status_code == 200
    live = client.app.state.live
    start = clock.current
    if boundary == "cap":
        # Keep lease alive through 89s so this tests the absolute cap, not an old lease.
        for seconds in range(5, 90, 5):
            clock.current = start + timedelta(seconds=seconds)
            assert action("heartbeat").status_code == 200
        clock.current = start + timedelta(seconds=89)
        assert action("heartbeat").status_code == 200
    clock.current = start + timedelta(seconds=(6 if boundary == "lease" else 90) + delta)
    assert live._current.status == "playing"  # No get_current/expiry tick before POST.
    response = client.post(
        f"/api/live/{sid}/questions",
        json={"questionId": "expiry-new-question", "sessionId": "viewer-expiry-001", "text": "New question"},
    )
    if delta < 0:
        assert response.status_code == 200, response.text
        assert response.json()["status"] == "queued"
        assert response.json()["sku"] == "KG-LC-250"
    else:
        assert response.status_code == 409, response.text
        assert response.json()["error"]["code"] == "live_not_running"
        assert live._current.status == "ended"
        assert live._current.questions == []
        assert live._active_question_id is None


@pytest.mark.parametrize("boundary", ["lease", "cap"])
def test_duplicate_question_http_remains_idempotent_after_expiry(host, boundary):
    client, sid, _, _, action, token, _, clock = host
    assert token().status_code == 200
    assert action("ready").status_code == 200
    start = clock.current
    body = {
        "questionId": "expiry-duplicate-001",
        "sessionId": "viewer-expiry-001",
        "text": "Accepted before expiry",
    }
    path = f"/api/live/{sid}/questions"
    first = client.post(path, json=body)
    assert first.status_code == 200
    if boundary == "cap":
        for seconds in range(5, 90, 5):
            clock.current = start + timedelta(seconds=seconds)
            assert action("heartbeat").status_code == 200
        clock.current = start + timedelta(seconds=89)
        assert action("heartbeat").status_code == 200
    clock.current = start + timedelta(seconds=6 if boundary == "lease" else 90)
    duplicate = client.post(path, json=body)
    assert duplicate.status_code == 200, duplicate.text
    assert duplicate.json()["questionId"] == first.json()["questionId"]
    assert duplicate.json()["status"] == "skipped"
    assert client.app.state.live._current.status == "ended"
    assert len(client.app.state.live._current.questions) == 1
    assert client.post(path, json={**body, "text": "conflict"}).status_code == 409


@pytest.mark.parametrize("skus", [["BT-XIKE-01"], ["BT-XIKE-01", "KG-LC-250"], ["KG-LC-250", "BT-XIKE-01"]])
def test_simli_audio_metadata_rejects_mismatched_or_multiple_skus(host, skus):
    client, sid, _, _, _, _, _, _ = host
    assert client.post(f"/api/admin/live/{sid}/end").status_code == 200
    r = client.post(
        "/api/admin/live", json={"title": "Wrong audio", "hostMode": "simli", "scheduledSkus": skus}
    )
    assert r.status_code == 422, r.text
    assert r.json()["error"]["code"] == "host_audio_sku_mismatch"
    assert client.app.state.live._current.live_id == sid
    assert client.app.state.live._current.status == "ended"


@pytest.mark.parametrize("configured", ["", "invalid sku", "X" * 40])
def test_missing_audio_sku_disables_ui_metadata_and_rejects_api(host, configured):
    client, sid, _, _, _, _, _, _ = host
    client.app.state.settings.live_simli_audio_sku = configured
    assert client.get("/api/admin/live/host-capabilities").json()["audioSku"] is None
    client.post(f"/api/admin/live/{sid}/end")
    r = client.post(
        "/api/admin/live", json={"title": "No mapping", "hostMode": "simli", "scheduledSkus": ["KG-LC-250"]}
    )
    assert r.status_code == 503
    assert r.json()["error"]["code"] == "host_audio_sku_missing"


def test_audio_sku_is_configuration_not_a_hardcoded_product(host):
    client, sid, cid, _, _, _, _, clock = host
    settings = client.app.state.settings
    settings.live_simli_audio_sku = " product-99 "
    capability = client.get("/api/admin/live/host-capabilities").json()
    assert capability["audioSku"] == "PRODUCT-99"
    assert "path" not in str(capability).lower()
    client.post(f"/api/admin/live/{sid}/end")
    created = client.post(
        "/api/admin/live",
        json={"title": "Mapped audio", "hostMode": "simli", "scheduledSkus": ["product-99"]},
    )
    assert created.status_code == 201, created.text
    assert created.json()["pinnedSku"] == "PRODUCT-99"
    clock.current += timedelta(seconds=120)
    acquired = client.post(f"/api/admin/live/{created.json()['liveId']}/host/acquire", json={"clientId": cid})
    assert acquired.status_code == 200


def test_configuration_change_cannot_send_mismatched_audio_or_token(host):
    client, sid, cid, lease, _, token, _, _ = host
    settings = client.app.state.settings
    settings.live_simli_audio_sku = "PRODUCT-99"
    assert token().status_code == 422
    assert not client.app.state.live._simli_host.token_requested
    audio = client.post(
        f"/api/admin/live/{sid}/host/audio", json={"clientId": cid}, headers={"X-Live-Host-Lease": lease}
    )
    assert audio.status_code == 422
    assert audio.json()["error"]["code"] == "host_audio_sku_mismatch"
    assert client.post(f"/api/admin/live/{sid}/host/acquire", json={"clientId": cid}).status_code == 422
    assert client.post(f"/api/admin/live/{sid}/pin", json={"sku": "PRODUCT-99"}).status_code == 409


def test_video_mode_keeps_multi_sku_playlist_with_no_audio_mapping(host):
    client, sid, _, _, _, _, _, _ = host
    client.app.state.settings.live_simli_audio_sku = ""
    client.post(f"/api/admin/live/{sid}/end")
    created = client.post(
        "/api/admin/live",
        json={
            "title": "Video multi SKU",
            "scheduledSkus": ["BT-XIKE-01", "KG-LC-250"],
            "scriptPlaylist": [
                {
                    "name": "A",
                    "sku": "BT-XIKE-01",
                    "videoUrl": "https://example.test/a.mp4",
                    "durationSeconds": 3.5,
                },
                {
                    "name": "B",
                    "sku": "KG-LC-250",
                    "videoUrl": "https://example.test/b.mp4",
                    "durationSeconds": 4.5,
                },
            ],
        },
    )
    assert created.status_code == 201, created.text
    assert created.json()["hostMode"] == "video"
    assert len(created.json()["scriptPlaylist"]) == 2
