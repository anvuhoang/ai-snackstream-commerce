import secrets

from fastapi import Depends, Request
from fastapi.security import APIKeyHeader

from app.core.config import Settings
from app.core.errors import AppError

_make_token_header = APIKeyHeader(name="X-Live-Make-Token", auto_error=False)


def require_make_callback(
    request: Request,
    token: str | None = Depends(_make_token_header),
) -> None:
    settings: Settings = request.app.state.settings
    expected = settings.live_make_callback_token.get_secret_value()

    if len(expected) < 32:
        raise AppError(
            503,
            "live_make_callback_not_configured",
            "Callback token is not configured.",
        )

    if token is None or not secrets.compare_digest(
        token.encode("utf-8"),
        expected.encode("utf-8"),
    ):
        raise AppError(
            403,
            "live_make_callback_forbidden",
            "Invalid callback token.",
        )