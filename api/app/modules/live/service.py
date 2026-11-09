from datetime import UTC, datetime
from threading import Lock
from uuid import uuid4

from app.core.errors import AppError

from .schemas import (
    LivePlaybackOut,
    LiveQuestionIn,
    LiveQuestionOut,
    LiveSessionCreate,
    LiveSessionOut,
)


class LiveService:
    def __init__(self):
        self._current: LiveSessionOut | None = None
        self._lock = Lock()
        self._question_requests: dict[str, LiveQuestionIn] = {}

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
                scheduled_skus=list(data.scheduled_skus),
                pinned_sku=data.scheduled_skus[0],
            )

            self._current = session
            self._question_requests.clear()
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

            session.playback = LivePlaybackOut(
                playback_id=uuid4().hex,
                video_url="/live-demo/avatar.mp4",
                started_at=datetime.now(UTC),
            )

            session.status = "playing"
            return session.model_copy(deep=True)

    def end_session(self, live_id: str) -> LiveSessionOut:
        with self._lock:
            session = self._require_current(live_id)
            session.status = "ended"
            session.playback = None

            for question in session.questions:
                if question.status == "queued":
                    question.status = "skipped"

            return session.model_copy(deep=True)

    def pin_sku(self, live_id: str, sku: str) -> LiveSessionOut:
        with self._lock:
            session = self._require_current(live_id)

            if session.status == "ended":
                raise AppError(
                    409,
                    "live_invalid_state",
                    "Cannot change SKU after the session ends.",
                )

            if sku not in session.scheduled_skus:
                raise AppError(
                    422,
                    "live_invalid_sku",
                    "SKU is not scheduled for this session.",
                )

            session.pinned_sku = sku
            return session.model_copy(deep=True)

    def submit_question(self, live_id: str, data: LiveQuestionIn) -> LiveQuestionOut:
        with self._lock:
            session = self._require_current(live_id)

            original = self._question_requests.get(data.question_id)
            if original is not None:
                if original != data:
                    raise AppError(
                        409,
                        "live_question_conflict",
                        "Question ID already used for another request.",
                    )

                existing = next(q for q in session.questions if q.question_id == data.question_id)
                return existing.model_copy(deep=True)

            if session.status not in ("playing", "paused"):
                raise AppError(409, "live_not_running", "Session is not accepting questions.")

            if len(session.questions) >= 100:
                raise AppError(429, "live_question_capacity", "Demo question capacity reached.")

            if sum(q.status == "queued" for q in session.questions) >= 3:
                raise AppError(429, "live_queue_full", "Question queue is full.")

            question = LiveQuestionOut(
                question_id=data.question_id,
                live_id=session.live_id,
                text=data.text,
                sku=session.pinned_sku,
                received_at=datetime.now(UTC),
                is_demo=session.is_demo,
            )

            session.questions.append(question)
            self._question_requests[data.question_id] = data.model_copy(deep=True)
            return question.model_copy(deep=True)

    def skip_question(self, live_id: str, question_id: str) -> LiveQuestionOut:
        with self._lock:
            session = self._require_current(live_id)
            question = next(
                (item for item in session.questions if item.question_id == question_id),
                None,
            )

            if question is None:
                raise AppError(
                    404,
                    "live_question_not_found",
                    "Question not found in this session.",
                )

            if question.status == "queued":
                question.status = "skipped"

            return question.model_copy(deep=True)

    def pause_session(self, live_id: str) -> LiveSessionOut:
        with self._lock:
            session = self._require_current(live_id)

            if session.status == "paused":
                return session.model_copy(deep=True)

            if session.status != "playing" or session.playback is None:
                raise AppError(
                    409,
                    "live_invalid_state",
                    "Only a playing session can be paused.",
                )

            session.playback.paused_at = datetime.now(UTC)
            session.status = "paused"
            return session.model_copy(deep=True)

    def resume_session(self, live_id: str) -> LiveSessionOut:
        with self._lock:
            session = self._require_current(live_id)

            if session.status == "playing":
                return session.model_copy(deep=True)

            if (
                session.status != "paused"
                or session.playback is None
                or session.playback.paused_at is None
            ):
                raise AppError(
                    409,
                    "live_invalid_state",
                    "Only a paused session can be resumed.",
                )

            paused_duration = datetime.now(UTC) - session.playback.paused_at
            session.playback.started_at += paused_duration
            session.playback.paused_at = None
            session.status = "playing"
            return session.model_copy(deep=True)