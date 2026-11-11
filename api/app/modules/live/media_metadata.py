"""Bounded, authenticated MP4 inspection; no live state or remote media fetching."""

import asyncio
import json
import math
import subprocess
from pathlib import Path
from tempfile import TemporaryDirectory

from fastapi import Request
from starlette.requests import ClientDisconnect

from app.core.errors import AppError

MAX_MEDIA_BYTES = 25 * 1024 * 1024
UPLOAD_TIMEOUT_SECONDS = 15
FFPROBE_TIMEOUT_SECONDS = 10


async def read_mp4(request: Request) -> bytes:
    settings = request.app.state.settings
    if not settings.live_make_enabled or settings.live_mock_enabled:
        raise AppError(503, "live_make_disabled", "Make integration is disabled.")
    if request.headers.get("content-type", "").split(";", 1)[0].strip().lower() != "video/mp4":
        raise AppError(415, "live_media_content_type", "Send raw MP4 with Content-Type video/mp4.")
    length = request.headers.get("content-length")
    if length is not None:
        if not length.isascii() or not length.isdecimal() or len(length) > 20:
            raise AppError(400, "live_media_length_invalid", "Invalid Content-Length.")
        if int(length) > MAX_MEDIA_BYTES:
            raise AppError(413, "live_media_too_large", "MP4 exceeds the 25 MiB limit.")
    content = bytearray()
    try:
        async with asyncio.timeout(UPLOAD_TIMEOUT_SECONDS):
            async for chunk in request.stream():
                if len(content) + len(chunk) > MAX_MEDIA_BYTES:
                    raise AppError(413, "live_media_too_large", "MP4 exceeds the 25 MiB limit.")
                content.extend(chunk)
    except TimeoutError:
        raise AppError(408, "live_media_upload_timeout", "MP4 upload timed out.") from None
    except ClientDisconnect:
        raise AppError(400, "live_media_upload_incomplete", "MP4 upload was interrupted.") from None
    # Ordinary MP4 carries an ISO BMFF file-type box; ffprobe validates the rest.
    if len(content) < 16 or content[4:8] != b"ftyp" or content[8:12] == b"qt  ":
        raise AppError(422, "live_media_invalid", "A valid MP4 video is required.")
    return bytes(content)


def probe_mp4(content: bytes, executable: str) -> float:
    """Run only in a worker thread. A local temporary file is the sole input."""
    with TemporaryDirectory(prefix="snackstream-media-") as directory:
        path = Path(directory) / "upload.mp4"
        path.write_bytes(content)
        try:
            result = subprocess.run(
                [
                    executable,
                    "-v",
                    "error",
                    "-protocol_whitelist",
                    "file",
                    "-f",
                    "mov",
                    "-enable_drefs",
                    "0",
                    "-use_absolute_path",
                    "0",
                    "-i",
                    str(path),
                    "-select_streams",
                    "v:0",
                    "-show_entries",
                    "format=format_name,duration:stream=codec_type",
                    "-of",
                    "json",
                ],
                stdin=subprocess.DEVNULL,
                stdout=subprocess.PIPE,
                stderr=subprocess.DEVNULL,
                timeout=FFPROBE_TIMEOUT_SECONDS,
                check=True,
                shell=False,
            )
        except subprocess.TimeoutExpired:
            raise AppError(504, "live_ffprobe_timeout", "Media inspection timed out.") from None
        except subprocess.CalledProcessError:
            raise AppError(422, "live_media_invalid", "MP4 could not be inspected.") from None
        except OSError:
            raise AppError(503, "live_ffprobe_unavailable", "ffprobe is not available.") from None

    try:
        if len(result.stdout) > 32768:
            raise ValueError
        metadata = json.loads(result.stdout)
        container = metadata["format"]
        if "mp4" not in container["format_name"].split(",") or not any(
            stream.get("codec_type") == "video" for stream in metadata["streams"]
        ):
            raise ValueError
        raw_duration = container.get("duration")
        if isinstance(raw_duration, bool):
            raise ValueError
        duration = float(raw_duration)
    except (ValueError, TypeError, KeyError, AttributeError, OverflowError):
        raise AppError(422, "live_media_duration_invalid", "MP4 has no valid container duration.") from None
    if not math.isfinite(duration) or not 0 < duration <= 300:
        raise AppError(422, "live_media_duration_invalid", "MP4 duration must be in (0, 300] seconds.")
    return duration
