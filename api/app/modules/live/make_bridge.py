import json
from datetime import UTC, datetime, timedelta
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit
from urllib.request import Request, urlopen

from app.core.config import Settings
from app.core.errors import AppError

from .schemas import LiveQuestionOut


def build_make_payload(question: LiveQuestionOut, timeout_seconds: float) -> dict[str, str | int]:
    claimed_at = question.processing_started_at
    if not isinstance(claimed_at, datetime) or claimed_at.utcoffset() is None:
        raise AppError(
            503,
            "live_make_missing_claim",
            "A timezone-aware processing claim timestamp is required.",
        )

    # Match service expiry arithmetic, then floor to milliseconds without floats.
    deadline = claimed_at + timedelta(seconds=timeout_seconds)
    deadline_unix_ms = (deadline - datetime(1970, 1, 1, tzinfo=UTC)) // timedelta(milliseconds=1)
    return {
        "session_id": question.live_id,
        "question_id": question.question_id,
        "question": question.text,
        "current_live_sku": question.sku,
        "source": question.source,
        "deadline_unix_ms": deadline_unix_ms,
    }


def send_make_question(question: LiveQuestionOut, settings: Settings) -> int:
    if not settings.live_make_enabled:
        raise AppError(503, "live_make_disabled", "Make integration is disabled.")

    url = settings.live_make_webhook_url.get_secret_value().strip()

    try:
        parsed = urlsplit(url)
        valid = (
            parsed.scheme == "https"
            and bool(parsed.hostname)
            and not parsed.username
            and not parsed.password
            and url.isascii()
            and not any(char.isspace() for char in url)
        )
    except ValueError:
        valid = False

    if not valid:
        raise AppError(
            503,
            "live_make_not_configured",
            "A valid HTTPS webhook URL is required.",
        )

    request = Request(
        url,
        data=json.dumps(
            build_make_payload(question, settings.live_make_result_timeout_seconds),
            ensure_ascii=False,
        ).encode("utf-8"),
        headers={"Content-Type": "application/json; charset=utf-8"},
        method="POST",
    )

    try:
        with urlopen(request, timeout=10) as response:
            status = response.status
    except HTTPError as exc:
        status = exc.code
        exc.close()
        raise AppError(
            502,
            "live_make_http_error",
            f"Make returned HTTP {status}.",
        ) from None
    except (URLError, OSError):
        raise AppError(
            502,
            "live_make_delivery_unknown",
            "Webhook delivery could not be confirmed.",
        ) from None

    if not 200 <= status < 300:
        raise AppError(
            502,
            "live_make_http_error",
            f"Make returned HTTP {status}.",
        )

    return status
