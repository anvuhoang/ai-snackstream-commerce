import json
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit
from urllib.request import Request, urlopen

from app.core.config import Settings
from app.core.errors import AppError

from .schemas import LiveQuestionOut


def build_make_payload(question: LiveQuestionOut) -> dict[str, str]:
    return {
        "session_id": question.live_id,
        "question_id": question.question_id,
        "question": question.text,
        "current_live_sku": question.sku,
        "source": question.source,
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
        data=json.dumps(build_make_payload(question), ensure_ascii=False).encode("utf-8"),
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