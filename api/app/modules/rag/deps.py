"""A route dependency: after an answer that changed the shop's text, bring the chatbot's passages up to date."""

from __future__ import annotations

from fastapi import BackgroundTasks, Request

from . import index


def refresh_chatbot_index(request: Request, tasks: BackgroundTasks) -> None:
    """Runs once the answer has been sent, so saving is not slowed down. Does nothing when the chatbot index is off."""

    def run() -> None:
        with request.app.state.session_factory() as db:
            index.rebuild_quietly(db, request.app.state.settings)

    tasks.add_task(run)
