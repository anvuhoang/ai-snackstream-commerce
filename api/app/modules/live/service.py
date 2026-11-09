from threading import Lock
from uuid import uuid4

from app.core.errors import AppError

from .schemas import LiveSessionCreate, LiveSessionOut


class LiveService:
    def __init__(self):
        self._current: LiveSessionOut | None = None
        self._lock = Lock()

    def get_current(self) -> LiveSessionOut | None:
        with self._lock:
            if self._current is None:
                return None

            return self._current.model_copy(deep=True)

    def create_session(self, data: LiveSessionCreate) -> LiveSessionOut:
        with self._lock:
            if self._current is not None and self._current.status != "ended":
                raise AppError(
                    409,
                    "live_session_exists",
                    "End the current session before creating another.",
                )

            session = LiveSessionOut(
                live_id=uuid4().hex,
                title=data.title,
            )

            self._current = session
            return session.model_copy(deep=True)

    def _require_current(self, live_id: str) -> LiveSessionOut:
        if self._current is None or self._current.live_id != live_id:
            raise AppError(
                404,
                "live_not_found",
                "Live session not found.",
            )

        return self._current

    def start_session(self, live_id: str) -> LiveSessionOut:
        with self._lock:
            session = self._require_current(live_id)

            if session.status != "not_started":
                raise AppError(
                    409,
                    "live_invalid_state",
                    "Only a not-started session can be started.",
                )

            session.status = "playing"
            return session.model_copy(deep=True)

    def end_session(self, live_id: str) -> LiveSessionOut:
        with self._lock:
            session = self._require_current(live_id)
            session.status = "ended"
            return session.model_copy(deep=True)
