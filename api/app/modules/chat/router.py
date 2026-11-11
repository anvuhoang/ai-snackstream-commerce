import secrets
from collections import deque
from threading import Lock
from time import monotonic

from fastapi import APIRouter, Depends, Query, Request, Response
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.core.errors import AppError
from app.modules.auth.deps import require_csrf, require_role
from app.modules.chat import logs, management
from app.modules.chat.schemas import (
    BotConfig,
    CardClick,
    ChatRequest,
    ChatResponse,
    FAQEntry,
    FAQInput,
    LogEntry,
    LogPage,
    PublicStatus,
    ReviewRequest,
    SupportEntry,
    SupportInput,
    SupportState,
)
from app.modules.chat.service import answer_chat

router = APIRouter(prefix="/api/chat", tags=["chat"])
_hits: deque[float] = deque()
_lock = Lock()


@router.post("/messages", response_model=ChatResponse)
def send_message(
    body: ChatRequest, request: Request, response: Response, db: Session = Depends(get_db)
) -> ChatResponse:
    # Global cost cap per process. Replace with shared Redis limits before scale-out.
    with _lock:
        now = monotonic()
        while _hits and now - _hits[0] > 60:
            _hits.popleft()
        if len(_hits) >= 20:
            raise AppError(429, "chat_rate_limited", "Please try again later")
        _hits.append(now)
    conversation = request.cookies.get("ss_chat", "")
    if len(conversation) != 64 or any(c not in "0123456789abcdef" for c in conversation):
        conversation = secrets.token_hex(32)
    row = logs.start(db, conversation, body.message, body.sku)
    started = monotonic()
    try:
        if not management.config(db).enabled:
            raise AppError(503, "bot_disabled", "Chatbot is disabled")
        handoff = management.support(db, conversation)
        if handoff and handoff.state == "active":
            raise AppError(409, "human_takeover", "A human has taken over this conversation")
        result = answer_chat(request.app.state.settings, body, management.faqs(db, approved_only=True))
    except AppError as exc:
        logs.finish(db, row, started, error=exc.code)
        raise
    except Exception:
        logs.finish(db, row, started, error="chat_internal_error")
        raise
    logs.finish(db, row, started, result=result)
    result.questionId = row.question_id
    response.set_cookie(
        "ss_chat",
        conversation,
        httponly=True,
        samesite="lax",
        secure=request.app.state.settings.is_prod,
        max_age=86400 * 30,
        path="/api/chat",
    )
    return result


@router.post("/questions/{question_id}/click", status_code=204)
def record_click(question_id: str, body: CardClick, request: Request, db: Session = Depends(get_db)):
    logs.click(db, question_id, request.cookies.get("ss_chat", ""), body.sku)
    return Response(status_code=204)


admin_router = APIRouter(
    prefix="/api/admin/chat", tags=["chat-admin"], dependencies=[Depends(require_role("admin", "staff"))]
)


@admin_router.get("/logs", response_model=LogPage)
def get_logs(
    offset: int = Query(0, ge=0),
    limit: int = Query(20, ge=1, le=100),
    needs_review: bool = False,
    db: Session = Depends(get_db),
):
    return logs.listing(db, offset, limit, needs_review)


@admin_router.patch("/logs/{question_id}", response_model=LogEntry, dependencies=[Depends(require_csrf)])
def review_log(question_id: str, body: ReviewRequest, db: Session = Depends(get_db)):
    return logs.review(db, question_id, body.reviewedCorrect)


@router.get("/status", response_model=PublicStatus)
def public_status(request: Request, db: Session = Depends(get_db)):
    row = management.support(db, request.cookies.get("ss_chat", ""))
    return PublicStatus(**management.config(db).model_dump(), supportState=row.state if row else None)


@router.post("/support", response_model=SupportEntry)
def ask_support(body: SupportInput, request: Request, response: Response, db: Session = Depends(get_db)):
    with _lock:
        now = monotonic()
        while _hits and now - _hits[0] > 60:
            _hits.popleft()
        if len(_hits) >= 20:
            raise AppError(429, "chat_rate_limited", "Please try again later")
        _hits.append(now)
    # Require a same-origin browser action; avoid unsolicited cross-site support requests.
    if request.headers.get("X-Chat-Action") != "support":
        raise AppError(403, "chat_action_invalid", "Missing chat action header")
    conversation = request.cookies.get("ss_chat", "")
    if len(conversation) != 64 or any(c not in "0123456789abcdef" for c in conversation):
        conversation = secrets.token_hex(32)
    result = management.request_support(db, conversation, body.message)
    response.set_cookie(
        "ss_chat",
        conversation,
        httponly=True,
        samesite="lax",
        secure=request.app.state.settings.is_prod,
        max_age=86400 * 30,
        path="/api/chat",
    )
    return result


@admin_router.get("/settings", response_model=BotConfig)
def get_bot_settings(db: Session = Depends(get_db)):
    return management.config(db)


@admin_router.put("/settings", response_model=BotConfig, dependencies=[Depends(require_csrf)])
def put_bot_settings(body: BotConfig, db: Session = Depends(get_db)):
    return management.save_config(db, body)


@admin_router.get("/faqs", response_model=list[FAQEntry])
def get_faqs(db: Session = Depends(get_db)):
    return management.faqs(db)


@admin_router.post("/faqs", response_model=FAQEntry, dependencies=[Depends(require_csrf)])
def add_faq(body: FAQInput, db: Session = Depends(get_db)):
    return management.save_faq(db, body)


@admin_router.put("/faqs/{faq_id}", response_model=FAQEntry, dependencies=[Depends(require_csrf)])
def update_faq(faq_id: int, body: FAQInput, db: Session = Depends(get_db)):
    return management.save_faq(db, body, faq_id)


@admin_router.delete("/faqs/{faq_id}", status_code=204, dependencies=[Depends(require_csrf)])
def remove_faq(faq_id: int, db: Session = Depends(get_db)):
    management.delete_faq(db, faq_id)
    return Response(status_code=204)


@admin_router.get("/support", response_model=list[SupportEntry])
def get_support(
    offset: int = Query(0, ge=0), limit: int = Query(20, ge=1, le=100), db: Session = Depends(get_db)
):
    return management.support_list(db, offset, limit)


@admin_router.patch(
    "/support/{support_id}", response_model=SupportEntry, dependencies=[Depends(require_csrf)]
)
def update_support(support_id: int, body: SupportState, db: Session = Depends(get_db)):
    return management.set_support(db, support_id, body.state)
