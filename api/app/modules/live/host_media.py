"""Server-only provider and audio I/O. Never accept an audio path or URL from a viewer."""

import re
from pathlib import Path

import httpx

from app.core.config import Settings
from app.core.errors import AppError

FACE_ID = "bf13113a-355a-4d97-8b90-4edccd1da7b2"


def require_enabled(settings: Settings):
    if not settings.live_simli_enabled:
        raise AppError(409, "host_disabled", "Simli host is disabled.")


def configured_audio_sku(settings: Settings) -> str | None:
    sku = settings.live_simli_audio_sku.strip().upper()
    return sku if re.fullmatch(r"[A-Z0-9][A-Z0-9_-]{1,38}", sku) else None


def require_audio_match(settings: Settings, skus: list[str] | None = None, pinned: str | None = None) -> str:
    require_enabled(settings)
    sku = configured_audio_sku(settings)
    if sku is None:
        raise AppError(503, "host_audio_sku_missing", "Configure the product SKU of the host audio file.")
    if (skus is not None and skus != [sku]) or (pinned is not None and pinned != sku):
        raise AppError(422, "host_audio_sku_mismatch", "This host audio supports only its configured SKU.")
    return sku


def audio_bytes(settings: Settings) -> bytes:
    require_enabled(settings)
    path = Path(settings.live_simli_audio_path)
    try:
        size = path.stat().st_size
        if not path.is_file() or not 32000 <= size <= 90 * 32000 or size % 2:
            raise ValueError()
        data = path.read_bytes()
        if len(data) != size:
            raise ValueError()
        return data
    except (OSError, ValueError):
        raise AppError(
            503, "host_audio_unavailable", "Configure a finite PCM16 16kHz mono audio file (1-90 seconds)."
        ) from None


def session_token(settings: Settings) -> str:
    require_enabled(settings)
    if settings.live_simli_transport == "mock":
        return "mock-local-transport"
    key = settings.live_simli_api_key.get_secret_value().strip()
    if not key:
        raise AppError(503, "host_key_missing", "Simli server key is not configured.")
    try:
        with httpx.Client(timeout=8, follow_redirects=False) as client:
            r = client.post(
                "https://api.simli.ai/compose/token",
                headers={"x-simli-api-key": key},
                json={
                    "faceId": FACE_ID,
                    "maxSessionLength": 90,
                    "maxIdleTime": 20,
                    "handleSilence": False,
                    "audioInputFormat": "pcm16",
                    "streaming_width": 768,
                    "streaming_height": 768,
                    "avatar_position_x": 0.5,
                    "avatar_position_y": 1.0,
                },
            )
        if r.status_code != 200:
            raise ValueError()
        token = r.json().get("session_token")
        if not isinstance(token, str) or not 8 <= len(token) <= 10000 or key in token:
            raise ValueError()
        return token
    except (httpx.HTTPError, ValueError):
        raise AppError(
            502, "host_provider_unavailable", "Host connection could not be prepared; no automatic retry."
        ) from None


def mock_video_bytes(settings: Settings) -> bytes:
    require_enabled(settings)
    from .media_metadata import MAX_MEDIA_BYTES

    try:
        p = Path(settings.live_simli_mock_video_path)
        size = p.stat().st_size
        if not p.is_file() or not 16 <= size <= MAX_MEDIA_BYTES:
            raise ValueError()
        data = p.read_bytes()
        if len(data) != size:
            raise ValueError()
        return data
    except (OSError, ValueError):
        raise AppError(
            503, "host_mock_video_unavailable", "Configure a local MP4 mock reply for this host."
        ) from None
