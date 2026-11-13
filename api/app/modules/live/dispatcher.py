import logging

from app.core.config import Settings
from app.core.errors import AppError

from .make_bridge import send_make_question
from .service import LiveService

logger = logging.getLogger(__name__)


def dispatch_next_question(
    live_id: str,
    live: LiveService,
    settings: Settings,
) -> None:
    if settings.live_make_enabled == settings.live_mock_enabled:
        return

    try:
        question = live.claim_next_question(live_id)
    except AppError as error:
        if error.code == "live_not_found":
            return
        raise

    if question is None:
        return

    if settings.live_mock_enabled:
        live.complete_mock_question(
            live_id,
            question.question_id,
            settings.live_mock_video_duration_seconds,
        )
        return

    try:
        send_make_question(question, settings)
    except AppError as error:
        live.record_make_dispatch_error(
            live_id,
            question.question_id,
            error.code,
        )
        logger.warning("Make delivery not confirmed: %s", error.code)
    except Exception as error:
        live.record_make_dispatch_error(
            live_id,
            question.question_id,
            "live_make_delivery_unknown",
        )
        logger.error("Unexpected Make delivery error: %s", type(error).__name__)
