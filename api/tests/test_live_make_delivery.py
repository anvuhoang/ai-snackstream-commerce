import json
from datetime import UTC, datetime
from unittest.mock import MagicMock
from urllib.error import HTTPError, URLError

import pytest
from pydantic import SecretStr

from app.core.config import Settings
from app.core.errors import AppError
from app.modules.live.make_bridge import send_make_question
from app.modules.live.schemas import LiveQuestionOut


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