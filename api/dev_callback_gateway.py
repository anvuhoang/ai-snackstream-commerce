"""Development-only callback forwarding; run this app locally on port 8010."""

from urllib.error import HTTPError, URLError
from urllib.request import Request as UrlRequest
from urllib.request import urlopen

from fastapi import Depends, FastAPI, Request
from fastapi.responses import Response

from app.core.config import Settings, get_settings
from app.core.errors import AppError, install_error_handlers
from app.modules.live.deps import require_make_callback
from app.modules.live.schemas import LiveMakeResultIn

CALLBACK_PATH = "/api/live/make-result"
BACKEND_URL = f"http://127.0.0.1:8000{CALLBACK_PATH}"


def create_callback_gateway(settings: Settings | None = None) -> FastAPI:
    gateway = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)
    gateway.state.settings = settings or get_settings()
    install_error_handlers(gateway)

    @gateway.post(CALLBACK_PATH, dependencies=[Depends(require_make_callback)])
    def forward_make_result(body: LiveMakeResultIn, request: Request) -> Response:
        upstream_request = UrlRequest(
            BACKEND_URL,
            data=body.model_dump_json(by_alias=True).encode("utf-8"),
            headers={
                "Content-Type": "application/json; charset=utf-8",
                "X-Live-Make-Token": request.headers["X-Live-Make-Token"],
            },
            method="POST",
        )

        try:
            try:
                upstream = urlopen(upstream_request, timeout=10)
            except HTTPError as error:
                upstream = error

            with upstream:
                content = upstream.read(32769)
                status = upstream.getcode()
        except (URLError, OSError):
            raise AppError(
                502,
                "live_backend_unavailable",
                "Local backend is unavailable.",
            ) from None

        if len(content) > 32768:
            raise AppError(
                502,
                "live_backend_response_invalid",
                "Unexpected local backend response.",
            )

        return Response(
            content=content,
            status_code=status,
            media_type="application/json",
        )

    return gateway


app = create_callback_gateway()