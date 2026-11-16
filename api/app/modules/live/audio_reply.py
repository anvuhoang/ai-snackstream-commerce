"""Make supplies answer text; existing TTS supplies PCM. No second question queue."""

from pathlib import Path

from fastapi import APIRouter, BackgroundTasks, Depends, Request

from app.core.errors import AppError

from . import service as clock_source
from .content import ContentSettings, create_audio, decode_audio, get_content_settings
from .deps import require_make_callback
from .schemas import LiveMakeAudioAnswerIn, LiveMakeResultAck

router = APIRouter()


def admission_locked(live, data, timeout):
    """Same lock, claim deadline and expiry rule as the MP4 callback."""
    s = live._current
    if s is None or s.live_id != data.live_id:
        return None, LiveMakeResultAck(applied=False, reason="stale_session")
    now = clock_source.datetime.now(clock_source.UTC)
    live._advance_script_locked(s, now)
    if s.status == "ended":
        return None, LiveMakeResultAck(applied=False, reason="session_ended")
    q = next((q for q in s.questions if q.question_id == data.question_id), None)
    if q is None:
        raise AppError(404, "live_question_not_found", "Question not found.")
    if q.sku != data.sku:
        raise AppError(409, "live_make_sku_mismatch", "Answer SKU differs from snapshot.")
    if s.host_mode != "simli" or q.reply_kind != "simli_audio":
        raise AppError(409, "live_reply_format_mismatch", "This question requires a video result.")
    saved = live._audio_answers.get(data.question_id)
    previous = live._make_results.get(data.question_id)
    if (saved is not None and saved != data) or (previous is not None and previous != data):
        raise AppError(409, "live_make_result_conflict", "Answer differs from the saved answer.")
    if previous is not None:
        return None, LiveMakeResultAck(applied=False, reason="duplicate")
    if live._expire_make_question_locked(q, now, timeout):
        raise AppError(409, "live_question_not_active", "Answer deadline has elapsed.")
    if live._active_question_id == q.question_id and q.status == "skipped":
        live._make_results[q.question_id] = data.model_copy(deep=True)
        live._active_question_id = None
        return None, LiveMakeResultAck(applied=False, reason="question_skipped")
    if live._active_question_id != q.question_id or q.status != "processing":
        raise AppError(409, "live_question_not_active", "Question is no longer processing.")
    return q, None


def begin_answer(live, data, timeout):
    with live._lock:
        q, ack = admission_locked(live, data, timeout)
        if ack:
            return ack
        if q.question_id in live._audio_answers:
            return LiveMakeResultAck(applied=False, reason="processing")
        live._audio_answers[q.question_id] = data.model_copy(deep=True)
        return LiveMakeResultAck(applied=True, reason="processing")


def finish_answer(live, data, timeout, pcm=None, error=None, *, source="make"):
    with live._lock:
        try:
            q, ack = admission_locked(live, data, timeout)
        except AppError:
            # Timeout, skip or a newer slot wins. Never resurrect it after I/O.
            return
        if ack or live._audio_answers.get(data.question_id) != data:
            return
        live._make_results[data.question_id] = data.model_copy(deep=True)
        q.result_received_at = clock_source.datetime.now(clock_source.UTC)
        if error:
            q.status = "failed"
            q.error_code = error
            live._active_question_id = None
            return
        live._reply_audio[q.question_id] = pcm
        q.reply_text = data.reply_text
        q.audio_duration_seconds = len(pcm) / 32000
        q.media_source = source
        q.status = "ready"


def render_answer(live, data, timeout, config):
    # Threadpool job; no provider/network I/O under the live lock, no retries.
    with live._lock:
        try:
            _, ack = admission_locked(live, data, timeout)
        except AppError:
            return
        if ack:
            return
    try:
        pcm = create_audio(data.reply_text, config)
    except AppError:
        finish_answer(live, data, timeout, error="generation_failed")
        return
    except Exception:
        finish_answer(live, data, timeout, error="generation_failed")
        return
    finish_answer(live, data, timeout, pcm)


def complete_mock_audio(live, question, settings, config):
    data = LiveMakeAudioAnswerIn(
        live_id=question.live_id,
        question_id=question.question_id,
        sku=question.sku,
        reply_text="Mock audio for playback only; not an answer to this question.",
    )
    timeout = settings.live_make_result_timeout_seconds
    ack = begin_answer(live, data, timeout)
    if not ack.applied:
        return
    try:
        path = Path(config.mock_reply_wav_path)
        if not config.mock_reply_wav_path or not path.is_file() or path.stat().st_size > 90 * 32000 + 65536:
            raise ValueError
        pcm = decode_audio(path.read_bytes())
    except (OSError, ValueError, AppError):
        finish_answer(live, data, timeout, error="generation_failed")
        return
    finish_answer(live, data, timeout, pcm, source="prerecorded")


@router.post("/make-answer", response_model=LiveMakeResultAck, dependencies=[Depends(require_make_callback)])
def make_answer(
    body: LiveMakeAudioAnswerIn,
    request: Request,
    background_tasks: BackgroundTasks,
    config: ContentSettings = Depends(get_content_settings),
):
    s = request.app.state.settings
    if not s.live_make_enabled or s.live_mock_enabled:
        raise AppError(503, "live_make_disabled", "Make integration is disabled.")
    if not config.reply_audio_enabled or not config.audio_configured:
        raise AppError(503, "live_reply_audio_not_configured", "Configure live reply TTS.")
    live = request.app.state.live
    ack = begin_answer(live, body, s.live_make_result_timeout_seconds)
    if ack.applied:
        background_tasks.add_task(render_answer, live, body, s.live_make_result_timeout_seconds, config)
    return ack
