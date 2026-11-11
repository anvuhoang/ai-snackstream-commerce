from datetime import UTC, datetime, timedelta
from threading import Lock
from uuid import uuid4

from app.core.errors import AppError

from .schemas import (
    LiveMakeResultAck,
    LiveMakeResultIn,
    LivePlaybackOut,
    LiveQuestionIn,
    LiveQuestionOut,
    LiveSessionCreate,
    LiveSessionOut,
)

# One shared preload window; no viewer acknowledgement can extend the session.
REPLY_PREPARATION_SECONDS = 5.0


class LiveService:
    def __init__(self):
        self._current: LiveSessionOut | None = None
        self._lock = Lock()
        self._question_requests: dict[str, LiveQuestionIn] = {}
        self._active_question_id: str | None = None
        self._make_results: dict[str, LiveMakeResultIn] = {}
        self._script_playback: LivePlaybackOut | None = None

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
            self._active_question_id = None
            self._make_results.clear()
            self._script_playback = None
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
            self._script_playback = None

            for question in session.questions:
                if question.status in ("queued", "processing", "ready", "answering"):
                    question.status = "skipped"

            self._active_question_id = None
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

            if question.status in ("queued", "processing", "ready", "answering"):
                if question.status == "answering" and not self._restore_script(
                    session, datetime.now(UTC)
                ):
                    raise AppError(409, "live_invalid_state", "Cannot restore script playback.")
                if (
                    question.status in ("ready", "answering")
                    and self._active_question_id == question_id
                ):
                    self._active_question_id = None
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

    def claim_next_question(self, live_id: str) -> LiveQuestionOut | None:
        with self._lock:
            session = self._require_current(live_id)

            if session.status != "playing" or self._active_question_id is not None:
                return None

            question = next(
                (item for item in session.questions if item.status == "queued"),
                None,
            )

            if question is None:
                return None

            question.status = "processing"
            question.processing_started_at = datetime.now(UTC)
            self._active_question_id = question.question_id

            return question.model_copy(deep=True)

    def start_ready_reply(self, live_id: str) -> bool:
        with self._lock:
            session = self._current
            if (
                session is None
                or session.live_id != live_id
                or session.status != "playing"
                or session.playback is None
                or session.playback.kind != "script"
                or self._script_playback is not None
            ):
                return False

            question = next(
                (
                    item for item in session.questions
                    if item.question_id == self._active_question_id
                ),
                None,
            )
            if (
                question is None
                or question.status != "ready"
                or question.media_source not in ("prerecorded", "make")
                or question.video_url is None
                or question.video_duration_seconds is None
            ):
                return False

            now = datetime.now(UTC)
            reply = LivePlaybackOut(
                playback_id=uuid4().hex,
                video_url=question.video_url,
                started_at=now + timedelta(seconds=REPLY_PREPARATION_SECONDS),
                kind="reply",
                media_source=question.media_source,
                question_id=question.question_id,
                duration_seconds=question.video_duration_seconds,
            )
            self._script_playback = session.playback.model_copy(deep=True)
            self._script_playback.paused_at = now
            session.playback = reply
            question.status = "answering"
            return True

    def _restore_script(self, session: LiveSessionOut, now: datetime) -> bool:
        script = self._script_playback
        if script is None or script.paused_at is None:
            return False

        restored = script.model_copy(deep=True)
        restored.started_at += now - script.paused_at
        restored.paused_at = now if session.status == "paused" else None
        restored.playback_id = uuid4().hex
        session.playback = restored
        self._script_playback = None
        return True

    def finish_reply(self, live_id: str) -> bool:
        with self._lock:
            session = self._current
            if (
                session is None
                or session.live_id != live_id
                or session.status != "playing"
                or session.playback is None
                or session.playback.kind != "reply"
                or session.playback.duration_seconds is None
                or session.playback.question_id != self._active_question_id
            ):
                return False

            question = next(
                (
                    item for item in session.questions
                    if item.question_id == self._active_question_id
                ),
                None,
            )
            if question is None or question.status != "answering":
                return False

            now = datetime.now(UTC)
            elapsed = (now - session.playback.started_at).total_seconds()
            if elapsed < session.playback.duration_seconds:
                return False
            if not self._restore_script(session, now):
                return False

            question.status = "answered"
            self._active_question_id = None
            return True

    def complete_mock_question(
        self, live_id: str, question_id: str, duration_seconds: float
    ) -> bool:
        with self._lock:
            session = self._current
            if (
                session is None
                or session.live_id != live_id
                or session.status == "ended"
                or self._active_question_id != question_id
            ):
                return False

            question = next(
                (item for item in session.questions if item.question_id == question_id),
                None,
            )
            if question is None:
                return False
            if question.status == "skipped":
                self._active_question_id = None
                return False
            if question.status != "processing":
                return False

            prepared = LiveQuestionOut.model_validate(
                {
                    **question.model_dump(),
                    "status": "ready",
                    "result_received_at": datetime.now(UTC),
                    "reply_text": (
                        "Video mô phỏng để kiểm tra phát và tiếp tục phiên live. "
                        "Đây không phải câu trả lời được tạo cho câu hỏi này."
                    ),
                    "video_url": "/live-demo/avatar.mp4",
                    "media_source": "prerecorded",
                    "video_duration_seconds": duration_seconds,
                }
            )
            session.questions[session.questions.index(question)] = prepared
            return True

    def receive_make_result(self, data: LiveMakeResultIn, timeout_seconds: float) -> LiveMakeResultAck:
        with self._lock:
            session = self._current

            if session is None or session.live_id != data.live_id:
                return LiveMakeResultAck(applied=False, reason="stale_session")

            if session.status == "ended":
                return LiveMakeResultAck(applied=False, reason="session_ended")

            previous = self._make_results.get(data.question_id)
            if previous is not None:
                if previous != data:
                    raise AppError(
                        409,
                        "live_make_result_conflict",
                        "Result differs from the saved result.",
                    )
                return LiveMakeResultAck(applied=False, reason="duplicate")

            question = next(
                (item for item in session.questions if item.question_id == data.question_id),
                None,
            )

            if question is None:
                raise AppError(
                    404,
                    "live_question_not_found",
                    "Question not found in this session.",
                )

            if (
                self._active_question_id != data.question_id
                or question.processing_started_at is None
                or question.status not in ("processing", "skipped")
            ):
                raise AppError(
                    409,
                    "live_question_not_active",
                    "Question is not being processed.",
                )

            if data.sku != question.sku:
                raise AppError(
                    409,
                    "live_make_sku_mismatch",
                    "Result SKU differs from the question SKU.",
                )

            now = datetime.now(UTC)
            if self._expire_make_question_locked(question, now, timeout_seconds):
                raise AppError(
                    409,
                    "live_question_not_active",
                    "Question is not being processed.",
                )

            self._make_results[data.question_id] = data.model_copy(deep=True)
            question.result_received_at = now
            question.provider_talk_id = data.provider_talk_id

            if question.status == "skipped":
                self._active_question_id = None
                return LiveMakeResultAck(applied=False, reason="question_skipped")

            question.status = data.status
            question.reply_text = data.reply_text
            question.video_url = str(data.video_url) if data.video_url is not None else None
            question.media_source = "make" if data.status == "ready" else None
            question.video_duration_seconds = data.duration_seconds
            question.error_code = data.error_code

            if data.status != "ready":
                self._active_question_id = None

            return LiveMakeResultAck(applied=True, reason="accepted")

    def expire_make_question(self, live_id: str, timeout_seconds: float) -> bool:
        """Release a missing/invalid callback, including an abandoned skipped request.

        Rendering is external work: its deadline continues during a session pause.
        Ready/playing results must never expire, and late results cannot reclaim a slot.
        """
        with self._lock:
            session = self._current
            if session is None or session.live_id != live_id or session.status == "ended":
                return False
            question = next(
                (item for item in session.questions if item.question_id == self._active_question_id),
                None,
            )
            return self._expire_make_question_locked(question, datetime.now(UTC), timeout_seconds)

    def _expire_make_question_locked(
        self, question: LiveQuestionOut | None, now: datetime, timeout_seconds: float,
    ) -> bool:
        """Caller holds _lock; both callback admission and runtime use this rule.

        Do not acquire the non-reentrant lock again. A saved result is immutable,
        so duplicate handling must precede this check in receive_make_result.
        """
        if (
            question is None
            or question.question_id != self._active_question_id
            or question.status not in ("processing", "skipped")
            or question.processing_started_at is None
            or question.question_id in self._make_results
            or now < question.processing_started_at + timedelta(seconds=timeout_seconds)
        ):
            return False
        if question.status == "processing":
            question.status = "failed"
        question.error_code = "generation_timeout"
        self._active_question_id = None
        return True

    def record_make_dispatch_error(
        self,
        live_id: str,
        question_id: str,
        code: str,
    ) -> None:
        with self._lock:
            session = self._current
            if (
                session is None
                or session.live_id != live_id
                or session.status == "ended"
                or self._active_question_id != question_id
                or question_id in self._make_results
            ):
                return

            question = next(
                (item for item in session.questions if item.question_id == question_id),
                None,
            )
            if question is None:
                return

            question.error_code = code

            if code in ("live_make_disabled", "live_make_not_configured"):
                if question.status == "processing":
                    question.status = "failed"
                self._active_question_id = None
