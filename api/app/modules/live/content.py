"""Opt-in live narration. Secrets stay in process settings; no implicit provider calls."""

import io
import json
import logging
import re
import wave
from dataclasses import dataclass
from functools import lru_cache
from time import monotonic

import httpx
from pydantic import Field, SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict

from app.core.errors import AppError

from .schemas import LiveContentOut, LiveProduct


class ContentSettings(BaseSettings):
    # Module-local, process-only configuration: do not change common settings or private .env.
    model_config = SettingsConfigDict(env_file=None, extra="ignore", populate_by_name=True)
    enabled: bool = Field(False, alias="LIVE_CONTENT_ENABLED")
    reply_audio_enabled: bool = Field(False, alias="LIVE_SIMLI_REPLY_AUDIO_ENABLED")
    mock_reply_wav_path: str = Field("", alias="LIVE_SIMLI_MOCK_REPLY_WAV_PATH")
    elevenlabs_key: SecretStr = Field(default=SecretStr(""), alias="ELEVENLABS_API_KEY")
    voice_id: str = Field("", alias="ELEVENLABS_VOICE_ID")
    tts_model: str = Field("", alias="ELEVENLABS_MODEL_ID")

    @property
    def audio_configured(self):
        return self.enabled and bool(
            self.elevenlabs_key.get_secret_value().strip()
            and re.fullmatch(r"[A-Za-z0-9_-]{1,100}", self.voice_id)
            and self.tts_model.strip()
        )


@lru_cache
def get_content_settings() -> ContentSettings:
    return ContentSettings()


@dataclass
class PreparedContent:
    product: LiveProduct
    script: str | None = None
    audio: bytes | None = None
    busy: str | None = None

    def output(self):
        return LiveContentOut(
            product=self.product.model_copy(deep=True),
            script=self.script,
            status=self.busy or ("ready" if self.audio else "script_ready" if self.script else "empty"),
            duration_seconds=len(self.audio) / 32000 if self.audio else None,
            audio_format="pcm_s16le_16000_mono" if self.audio else None,
        )


def prepared_locked(live, live_id: str) -> PreparedContent:
    """Caller holds the existing live lock. No network I/O under this lock."""
    session = live._require_current(live_id)
    if session.host_mode != "simli" or live._host_content is None:
        raise AppError(
            409, "live_content_unavailable", "This session does not use generated product narration."
        )
    return live._host_content


def editable_locked(live, live_id: str):
    content = prepared_locked(live, live_id)
    if live._current.status != "not_started" or live._simli_host is not None:
        raise AppError(409, "live_content_locked", "Prepare narration before starting the host.")
    return content


_PROVIDER_ERROR_CODES = frozenset(
    {
        "invalid_api_key",
        "insufficient_quota",
        "credit_balance_exhausted",
        "organization_spend_limit_exceeded",
        "project_spend_limit_exceeded",
        "organization_usage_limit_exceeded",
        "rate_limit_exceeded",
        "slow_down",
        "model_not_found",
        "unsupported_parameter",
        "invalid_value",
        "invalid_json_schema",
        "quota_exceeded",
        "max_character_limit_exceeded",
        "invalid_voice_id",
        "voice_not_found",
        "invalid_model_id",
        "invalid_output_format",
        "invalid_language_code",
        "model_access_denied",
        "voice_access_denied",
        "voice_not_allowed",
        "feature_not_available",
        "subscription_required",
        "missing_permissions",
        "concurrent_limit_exceeded",
        "insufficient_permissions",
        "server_is_overloaded",
    }
)
_PROVIDER_ERROR_TYPES = frozenset(
    {
        "invalid_request_error",
        "authentication_error",
        "insufficient_quota",
        "rate_limit_error",
        "permission_error",
        "server_error",
        "service_unavailable_error",
        "validation_error",
        "invalid_request",
        "authorization_error",
        "not_found",
        "payment_required",
        "internal_error",
        "service_unavailable",
    }
)


def _log_provider_failure(response: httpx.Response, deadline: float) -> None:
    """Log only bounded, allowlisted error metadata. Never log provider messages."""
    code = kind = "unavailable"
    try:
        raw = bytearray()
        for chunk in response.iter_bytes(chunk_size=1024):
            if monotonic() >= deadline or len(raw) + len(chunk) > 8192:
                break
            raw.extend(chunk)
        else:
            payload = json.loads(raw)
            error = payload.get("error") or payload.get("detail")
            if isinstance(error, dict):
                value = error.get("code") or error.get("status")
                code = value if isinstance(value, str) and value in _PROVIDER_ERROR_CODES else "other"
                value = error.get("type")
                kind = value if isinstance(value, str) and value in _PROVIDER_ERROR_TYPES else "other"
    except (httpx.HTTPError, ValueError, TypeError, AttributeError):
        pass
    request_id = response.headers.get("x-request-id", "")
    if not re.fullmatch(r"req_[A-Za-z0-9_-]{1,100}", request_id):
        request_id = "unavailable"
    logging.getLogger(__name__).warning(
        "Live content provider rejected request: status=%s code=%s type=%s request_id=%s",
        response.status_code,
        code,
        kind,
        request_id,
    )


def request_bytes(url, headers, body, limit: int, media_types: tuple[str, ...]) -> bytes:
    """Fixed provider URLs only; bounded responses, no redirects or automatic retries."""
    try:
        deadline = monotonic() + 45
        with (
            httpx.Client(timeout=httpx.Timeout(30, connect=5), follow_redirects=False, trust_env=False) as c,
            c.stream("POST", url, headers=headers, json=body) as response,
        ):
            if response.status_code != 200:
                _log_provider_failure(response, deadline)
                raise AppError(
                    502,
                    "live_content_provider_error",
                    "Content provider returned an error; no automatic retry.",
                )
            kind = response.headers.get("content-type", "").split(";", 1)[0].lower()
            if kind not in media_types:
                raise AppError(
                    502, "live_content_format_invalid", "Content provider returned an unexpected media type."
                )
            result = bytearray()
            for chunk in response.iter_bytes():
                if monotonic() >= deadline:
                    raise AppError(
                        504, "live_content_timeout", "Content request timed out; no automatic retry."
                    )
                if len(result) + len(chunk) > limit:
                    raise AppError(
                        422,
                        "live_content_too_large",
                        "Content exceeds the limit; shorten the supplied product facts.",
                    )
                result.extend(chunk)
            return bytes(result)
    except httpx.TimeoutException:
        raise AppError(
            504, "live_content_timeout", "Content request timed out; no automatic retry."
        ) from None
    except httpx.HTTPError:
        raise AppError(502, "live_content_connection", "Content provider connection failed.") from None


def create_audio(script: str, config: ContentSettings) -> bytes:
    if not config.audio_configured:
        raise AppError(503, "live_tts_not_configured", "Configure the ElevenLabs voice and model.")
    data = request_bytes(
        f"https://api.elevenlabs.io/v1/text-to-speech/{config.voice_id}?output_format=wav_16000",
        {"xi-api-key": config.elevenlabs_key.get_secret_value()},
        {"text": script, "model_id": config.tts_model, "language_code": "vi"},
        90 * 32000 + 65536,
        ("audio/wav", "audio/x-wav", "audio/wave", "application/octet-stream"),
    )
    return decode_audio(data)


def decode_audio(data: bytes) -> bytes:
    # Validate the provider container before stripping it to the existing Simli PCM format.
    # Duration is the actual frame count / sample rate, not a text/bitrate estimate.
    try:
        with wave.open(io.BytesIO(data), "rb") as audio:
            if (audio.getnchannels(), audio.getsampwidth(), audio.getframerate(), audio.getcomptype()) != (
                1,
                2,
                16000,
                "NONE",
            ) or not 16000 <= audio.getnframes() <= 90 * 16000:
                raise ValueError
            frames = audio.getnframes()
            pcm = audio.readframes(frames)
            if len(pcm) != frames * 2 or not any(pcm):
                raise ValueError
        return pcm
    except (wave.Error, EOFError, ValueError):
        raise AppError(
            422, "live_audio_invalid", "Expected complete mono PCM16 WAV at 16000 Hz, 1-90 seconds."
        ) from None


def bound_audio_locked(live, settings, session):
    """Use the session's generated bytes when requested. Never fall back to configured demo audio."""
    from .host_media import audio_bytes, require_audio_match, require_enabled

    require_enabled(settings)
    if session.products:
        content = prepared_locked(live, session.live_id)
        if not content.audio or not content.script:
            raise AppError(409, "live_audio_not_ready", "Generate narration before starting the host.")
        sku = content.product.sku
        if session.scheduled_skus != [sku] or session.pinned_sku != sku:
            raise AppError(
                422, "host_audio_sku_mismatch", "Host narration SKU does not match the live session."
            )
        return sku, content.audio
    return require_audio_match(settings, session.scheduled_skus, session.pinned_sku), audio_bytes(settings)
