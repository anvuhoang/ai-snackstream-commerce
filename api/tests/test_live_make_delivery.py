import json
from datetime import UTC, datetime, timedelta
from unittest.mock import MagicMock
from urllib.error import HTTPError, URLError

import pytest
from pydantic import SecretStr

from app.core.config import Settings
from app.core.errors import AppError
from app.modules.live import service as service_module
from app.modules.live.dispatcher import dispatch_next_question
from app.modules.live.make_bridge import send_make_question
from app.modules.live.schemas import LiveQuestionIn, LiveQuestionOut, LiveSessionCreate
from app.modules.live.service import LiveService


@pytest.fixture
def make_settings():
    return Settings(
        _env_file=None,
        LIVE_MAKE_ENABLED=True,
        LIVE_MAKE_WEBHOOK_URL="https://hook.eu1.make.com/example-private",
    )


@pytest.fixture
def question():
    return LiveQuestionOut(
        question_id="question-test-001",
        live_id="live-test-001",
        text="Bánh tráng này có cay không?",
        sku="BT-XIKE-01",
        received_at=datetime(2026, 11, 10, tzinfo=UTC),
        processing_started_at=datetime(2026, 11, 10, tzinfo=UTC),
    )


@pytest.mark.parametrize("status", [200, 202])
def test_send_posts_utf8_and_returns_ack(
    monkeypatch, make_settings, question, status
):
    response = MagicMock()
    response.__enter__.return_value.status = status
    opener = MagicMock(return_value=response)
    monkeypatch.setattr("app.modules.live.make_bridge.urlopen", opener)

    assert send_make_question(question, make_settings) == status
    opener.assert_called_once()

    request = opener.call_args.args[0]
    assert request.get_method() == "POST"
    assert json.loads(request.data)["question"] == "Bánh tráng này có cay không?"
    payload = json.loads(request.data)
    assert type(payload["deadline_unix_ms"]) is int
    assert payload["deadline_unix_ms"] == 1_794_268_980_000
    assert opener.call_args.kwargs["timeout"] == 10


def test_disabled_does_not_send(monkeypatch, make_settings, question):
    opener = MagicMock()
    monkeypatch.setattr("app.modules.live.make_bridge.urlopen", opener)
    make_settings.live_make_enabled = False

    with pytest.raises(AppError) as caught:
        send_make_question(question, make_settings)

    assert caught.value.code == "live_make_disabled"
    opener.assert_not_called()


@pytest.mark.parametrize("url", ["", "http://example.invalid/test"])
def test_missing_or_insecure_url_does_not_send(
    monkeypatch, make_settings, question, url
):
    opener = MagicMock()
    monkeypatch.setattr("app.modules.live.make_bridge.urlopen", opener)
    make_settings.live_make_webhook_url = SecretStr(url)

    with pytest.raises(AppError) as caught:
        send_make_question(question, make_settings)

    assert caught.value.code == "live_make_not_configured"
    opener.assert_not_called()


@pytest.mark.parametrize("status", [400, 429, 500])
def test_http_error_does_not_retry(
    monkeypatch, make_settings, question, status
):
    url = make_settings.live_make_webhook_url.get_secret_value()
    opener = MagicMock(
        side_effect=HTTPError(url, status, "Error", None, None)
    )
    monkeypatch.setattr("app.modules.live.make_bridge.urlopen", opener)

    with pytest.raises(AppError) as caught:
        send_make_question(question, make_settings)

    assert caught.value.code == "live_make_http_error"
    assert url not in str(caught.value)
    opener.assert_called_once()


@pytest.mark.parametrize("claimed_at", [None, datetime(2026, 11, 10), "invalid", True])
def test_missing_or_invalid_claim_never_sends(monkeypatch, make_settings, question, claimed_at):
    opener = MagicMock()
    monkeypatch.setattr("app.modules.live.make_bridge.urlopen", opener)
    # model_copy deliberately bypasses validation to exercise invalid internal state.
    question = question.model_copy(update={"processing_started_at": claimed_at})
    with pytest.raises(AppError) as caught:
        send_make_question(question, make_settings)
    assert caught.value.code == "live_make_missing_claim"
    opener.assert_not_called()


@pytest.mark.parametrize("timeout", [180, 7.5, 0.001234, 1800])
@pytest.mark.parametrize("send_delay", [0, 25, 181])
def test_dispatch_deadline_stays_at_claim_despite_delayed_send(
    monkeypatch, make_settings, timeout, send_delay,
):
    class Clock(datetime):
        current = datetime(2026, 11, 11, microsecond=123_999, tzinfo=UTC)

        @classmethod
        def now(cls, tz=None):
            return cls.current if tz is not None else cls.current.replace(tzinfo=None)

    monkeypatch.setattr(service_module, "datetime", Clock)
    make_settings.live_make_result_timeout_seconds = timeout
    make_settings.live_mock_enabled = False
    service = LiveService()
    session = service.create_session(LiveSessionCreate(
        title="Payload deadline", scheduled_skus=["BT-XIKE-01", "KG-LC-250"],
    ))
    service.start_session(session.live_id)
    service.submit_question(session.live_id, LiveQuestionIn(
        question_id="deadline-question-001", session_id="deadline-viewer-001",
        text="Bánh tráng này có cay không?",
    ))
    service.pin_sku(session.live_id, "KG-LC-250")
    Clock.current += timedelta(seconds=20)  # Waiting in queue is excluded.
    claimed_at = Clock.current
    response = MagicMock()
    response.__enter__.return_value.status = 202
    opener = MagicMock(return_value=response)
    monkeypatch.setattr("app.modules.live.make_bridge.urlopen", opener)

    def delayed_send(question, settings):
        assert question.processing_started_at == claimed_at
        Clock.current += timedelta(seconds=send_delay)
        return send_make_question(question, settings)

    monkeypatch.setattr("app.modules.live.dispatcher.send_make_question", delayed_send)
    dispatch_next_question(session.live_id, service, make_settings)
    opener.assert_called_once()
    payload = json.loads(opener.call_args.args[0].data)
    expected_ms = (
        claimed_at + timedelta(seconds=timeout) - datetime(1970, 1, 1, tzinfo=UTC)
    ) // timedelta(milliseconds=1)
    assert type(payload["deadline_unix_ms"]) is int
    assert payload == {
        "session_id": session.live_id,
        "question_id": "deadline-question-001",
        "question": "Bánh tráng này có cay không?",
        "current_live_sku": "BT-XIKE-01",
        "source": "web_live",
        "deadline_unix_ms": expected_ms,
    }
    assert service.get_current().questions[0].processing_started_at == claimed_at


def test_network_failure_is_unknown_and_does_not_retry(
    monkeypatch, make_settings, question
):
    url = make_settings.live_make_webhook_url.get_secret_value()
    opener = MagicMock(side_effect=URLError(url))
    monkeypatch.setattr("app.modules.live.make_bridge.urlopen", opener)

    with pytest.raises(AppError) as caught:
        send_make_question(question, make_settings)

    assert caught.value.code == "live_make_delivery_unknown"
    assert url not in str(caught.value)
    opener.assert_called_once()
