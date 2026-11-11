import asyncio
import logging

from app.core.config import Settings

from .dispatcher import dispatch_next_question
from .service import LiveService

logger = logging.getLogger(__name__)


def _advance_playback(live: LiveService, settings: Settings) -> str | None:
    if settings.live_mock_enabled == settings.live_make_enabled:
        return

    current = live.get_current()
    if current is None:
        return

    if settings.live_make_enabled:
        live.expire_make_question(current.live_id, settings.live_make_result_timeout_seconds)

    if current.status != "playing":
        return

    if live.finish_reply(current.live_id):
        return

    live.start_ready_reply(current.live_id)
    return current.live_id


def tick_playback(live: LiveService, settings: Settings) -> None:
    """One deterministic step for worker callers and fake-clock regression tests."""
    live_id = _advance_playback(live, settings)
    if live_id is None:
        return
    dispatch_next_question(live_id, live, settings)
    live.start_ready_reply(live_id)


async def run_playback(live: LiveService, settings: Settings) -> None:
    dispatch_task = None
    try:
        while True:
            try:
                if dispatch_task is not None and dispatch_task.done():
                    finished = dispatch_task
                    dispatch_task = None
                    finished.result()
                # Advance deadlines and ready replies even while webhook I/O waits.
                live_id = _advance_playback(live, settings)
                if live_id is not None and dispatch_task is None:
                    dispatch_task = asyncio.create_task(asyncio.to_thread(
                        dispatch_next_question, live_id, live, settings,
                    ))
            except Exception as error:
                logger.error("Live playback tick failed: %s", type(error).__name__)
            await asyncio.sleep(0.25)
    finally:
        if dispatch_task is not None:
            dispatch_task.cancel()
            await asyncio.gather(dispatch_task, return_exceptions=True)
