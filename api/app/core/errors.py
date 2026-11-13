"""One error shape for the whole API: {"error": {"code": "...", "message": "...", "details": ...?}}."""

from __future__ import annotations

from typing import Any

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse


class AppError(Exception):
    """Raise from services/routers for expected failures. `code` is stable and meant for clients."""

    def __init__(self, status_code: int, code: str, message: str, details: Any = None):
        super().__init__(message)
        self.status_code, self.code, self.message, self.details = status_code, code, message, details


def install_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(AppError)
    async def _app_error(_: Request, exc: AppError) -> JSONResponse:
        body: dict[str, Any] = {"code": exc.code, "message": exc.message}
        if exc.details is not None:
            body["details"] = exc.details
        return JSONResponse({"error": body}, status_code=exc.status_code)
