import io
import wave
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from threading import Event

import pytest
from pydantic import SecretStr

from app.core.errors import AppError
from app.modules.live import audio_reply, content, dispatcher
from app.modules.live.content import ContentSettings, get_content_settings
from app.modules.live.make_bridge import build_make_payload
from app.modules.live.schemas import LiveMakeAudioAnswerIn, LiveQuestionIn
from tests.test_live_simli_host import host as host  # noqa: F401


@pytest.fixture
def audio_host(host, monkeypatch):  # noqa: F811
    c, sid, cid, lease, action, token, _, clock = host
    settings = c.app.state.settings
    settings.live_make_enabled = True
    settings.live_make_callback_token = SecretStr("test-callback-token-no-provider-" * 2)
    cfg = ContentSettings(
        LIVE_CONTENT_ENABLED=True,
        LIVE_SIMLI_REPLY_AUDIO_ENABLED=True,
        ELEVENLABS_API_KEY="fake",
        ELEVENLABS_VOICE_ID="fake-voice",
        ELEVENLABS_MODEL_ID="fake",
    )
    c.app.dependency_overrides[get_content_settings] = lambda: cfg
    monkeypatch.setattr(dispatcher, "send_make_question", lambda *_: 200)
    live = c.app.state.live
    live._current.reply_format = "simli_audio"
    assert token().status_code == 200
    assert action("ready").status_code == 200
    qid = "audio-question-001"
    q = live.submit_question(sid, LiveQuestionIn(questionId=qid, sessionId="viewer-audio-001", text="price?"))
    assert q.reply_kind == "simli_audio"
    live.claim_next_question(sid)
    body = {
        "liveId": sid,
        "questionId": qid,
        "sku": "KG-LC-250",
        "replyText": "Verified supplied product answer.",
    }
    pcm = b"\x01\x10" * 16000 * 3
    calls = []
    monkeypatch.setattr(audio_reply, "create_audio", lambda text, _: calls.append(text) or pcm)
    return c, live, body, pcm, calls, cfg, action, clock, cid, lease


def post(c, body, **kw):
    return c.post(
        "/api/live/make-answer",
        json=body,
        headers={"X-Live-Make-Token": c.app.state.settings.live_make_callback_token.get_secret_value()},
        **kw,
    )


def test_text_to_tts_to_single_session_restore(audio_host):
    c, live, body, pcm, calls, cfg, action, _, cid, lease = audio_host
    assert post(c, body).json() == {"received": True, "applied": True, "reason": "processing"}
    q = live.get_current().questions[0]
    assert q.status == "ready" and q.video_url is None and q.audio_duration_seconds == 3
    assert calls == [body["replyText"]]
    headers = {"X-Live-Host-Lease": lease}
    route = f"/api/admin/live/{body['liveId']}/host/reply-audio/{body['questionId']}"
    assert c.post(route, json={"clientId": cid}, headers=headers).content == pcm
    assert c.post(route, json={"clientId": "wrong-producer"}, headers=headers).status_code == 403
    assert c.post(route, json={"clientId": cid}).status_code in (403, 422)
    assert action("handoff", body["questionId"], 6.926).status_code == 200
    assert action("reply_playing", body["questionId"]).status_code == 200
    assert action("reply_ended", body["questionId"]).status_code == 200
    assert action("restored", body["questionId"], 6.746).status_code == 200
    assert live.get_current().questions[0].status == "answered"
    assert post(c, body).json()["reason"] == "duplicate"
    assert len(calls) == 1
    assert c.post(route, json={"clientId": cid}, headers=headers).status_code == 409
    assert build_make_payload(q, 180)["reply_format"] == "simli_audio"


@pytest.mark.parametrize("change", ["text", "sku", "qid"])
def test_conflict_never_creates_second_audio(audio_host, change):
    c, _, body, _, calls, *_ = audio_host
    assert post(c, body).status_code == 200
    body = dict(body)
    body[{"text": "replyText", "sku": "sku", "qid": "questionId"}[change]] = {
        "text": "Different answer",
        "sku": "OTHER-SKU",
        "qid": "missing-question-002",
    }[change]
    assert post(c, body).status_code in (404, 409)
    assert len(calls) == 1


def test_auth_mode_and_invalid_text_never_call_tts(audio_host):
    c, _, body, _, calls, cfg, *_ = audio_host
    assert c.post("/api/live/make-answer", json=body).status_code == 403
    assert (
        c.post("/api/live/make-answer", json=body, headers={"X-Live-Make-Token": "wrong"}).status_code == 403
    )
    for value in ("", " ", "x" * 1201, None):
        assert post(c, {**body, "replyText": value}).status_code == 422
    cfg.reply_audio_enabled = False
    assert post(c, body).status_code == 503
    cfg.reply_audio_enabled = True
    c.app.state.settings.live_mock_enabled = True
    assert post(c, body).status_code == 503
    assert not calls


@pytest.mark.parametrize("seconds", [180, 181])
def test_deadline_without_tick_rejects_text(audio_host, seconds):
    c, live, body, _, calls, _, _, clock, *_ = audio_host
    # Isolate Make claim expiry from the independently enforced 90s host cap.
    live._simli_host.deadline += timedelta(seconds=300)
    live._simli_host.lease_until += timedelta(seconds=300)
    clock.current += timedelta(seconds=seconds)
    assert post(c, body).status_code == 409
    assert live.get_current().questions[0].error_code == "generation_timeout"
    assert not calls


@pytest.mark.parametrize("stop", ["end", "skip", "deadline", "host_cap"])
def test_tts_finishes_late_cannot_revive_or_replace_slot(audio_host, monkeypatch, stop):
    c, live, body, pcm, _, cfg, _, clock, *_ = audio_host
    data = LiveMakeAudioAnswerIn(**body)
    assert audio_reply.begin_answer(live, data, 180).applied
    entered, release = Event(), Event()

    def tts(*_):
        entered.set()
        assert release.wait(3)
        return pcm

    monkeypatch.setattr(audio_reply, "create_audio", tts)
    with ThreadPoolExecutor() as pool:
        work = pool.submit(audio_reply.render_answer, live, data, 180, cfg)
        assert entered.wait(2)
        # Calls below need the service lock; completing them proves no TTS I/O under it.
        if stop == "end":
            live.end_session(body["liveId"])
        elif stop == "skip":
            live.skip_question(body["liveId"], body["questionId"])
            live.submit_question(
                body["liveId"],
                LiveQuestionIn(questionId="audio-question-002", sessionId="viewer-audio-002", text="next"),
            )
            assert live.claim_next_question(body["liveId"]) is None
        else:
            clock.current += timedelta(seconds=180 if stop == "deadline" else 90)
            if stop == "deadline":
                live._simli_host.deadline += timedelta(seconds=300)
                live._simli_host.lease_until += timedelta(seconds=300)
        release.set()
        work.result(timeout=3)
    q = live.get_current().questions[0]
    assert q.status != "ready" and body["questionId"] not in live._reply_audio
    if stop == "skip":
        assert live.claim_next_question(body["liveId"]).question_id == "audio-question-002"
        audio_reply.finish_answer(live, data, 180, pcm)
        assert live._active_question_id == "audio-question-002"


def test_duplicate_inflight_and_after_deadline_do_not_repeat_tts(audio_host):
    _, live, body, pcm, calls, _, _, clock, *_ = audio_host
    data = LiveMakeAudioAnswerIn(**body)
    assert audio_reply.begin_answer(live, data, 180).applied
    assert not audio_reply.begin_answer(live, data, 180).applied
    audio_reply.finish_answer(live, data, 180, pcm)
    clock.current += timedelta(seconds=181)
    live._simli_host.deadline += timedelta(seconds=300)
    live._simli_host.lease_until += timedelta(seconds=300)
    assert audio_reply.begin_answer(live, data, 180).reason == "duplicate"
    assert not calls


def test_tts_error_is_terminal_without_retry(audio_host, monkeypatch):
    c, live, body, _, calls, *_ = audio_host

    def fail(*_):
        raise AppError(502, "live_content_provider_error", "safe error")

    monkeypatch.setattr(audio_reply, "create_audio", fail)
    assert post(c, body).status_code == 200
    q = live.get_current().questions[0]
    assert q.status == "failed" and q.error_code == "generation_failed"
    assert post(c, body).json()["reason"] == "duplicate"
    assert not calls


def test_decode_fixture_from_fake_tts_exact_duration():
    raw = io.BytesIO()
    with wave.open(raw, "wb") as w:
        w.setparams((1, 2, 16000, 0, "NONE", "not compressed"))
        w.writeframes(b"\x10\x00" * 16000 * 3)
    assert len(content.decode_audio(raw.getvalue())) == 96000


def test_preflight_deadline_and_wrong_mode_never_start_tts(audio_host):
    c, live, body, _, calls, cfg, _, clock, *_ = audio_host
    q = live._current.questions[0]
    q.reply_kind = "video"
    assert post(c, body).status_code == 409
    q.reply_kind = "simli_audio"
    data = LiveMakeAudioAnswerIn(**body)
    assert audio_reply.begin_answer(live, data, 180).applied
    clock.current += timedelta(seconds=90)
    audio_reply.render_answer(live, data, 180, cfg)
    assert not calls
    assert live.get_current().status == "ended"


def test_simultaneous_identical_callbacks_reserve_only_one_job(audio_host):
    _, live, body, *_ = audio_host
    data = LiveMakeAudioAnswerIn(**body)
    with ThreadPoolExecutor() as pool:
        results = list(pool.map(lambda _: audio_reply.begin_answer(live, data, 180), range(12)))
    assert sum(ack.applied for ack in results) == 1
    assert all(ack.reason == "processing" for ack in results)


def test_missing_mock_audio_fails_explicitly_without_fallback(audio_host):
    c, live, body, _, calls, cfg, *_ = audio_host
    q = live.get_current().questions[0]
    cfg.mock_reply_wav_path = "missing-audio-fixture.wav"
    audio_reply.complete_mock_audio(live, q, c.app.state.settings, cfg)
    result = live.get_current().questions[0]
    assert result.status == "failed" and result.error_code == "generation_failed"
    assert not calls and not live._reply_audio
