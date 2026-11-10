import asyncio
import logging

from app.core.config import Settings

from .dispatcher import dispatch_next_question
from .service import LiveService

logger = logging.getLogger(__name__)


def tick_mock_playback(live: LiveService, settings: Settings) -> None:
    if not settings.live_mock_enabled or settings.live_make_enabled:
        return

    current = live.get_current()
    if current is None or current.status != "playing":
        return

    if live.finish_reply(current.live_id):
        return

    dispatch_next_question(current.live_id, live, settings)
    live.start_ready_reply(current.live_id)


async def run_mock_playback(live: LiveService, settings: Settings) -> None:
    while True:
        try:
            tick_mock_playback(live, settings)
        except Exception as error:
            logger.error("Mock playback tick failed: %s", type(error).__name__)
        await asyncio.sleep(0.25)