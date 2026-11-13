import json
import secrets
from datetime import UTC
from time import monotonic
from uuid import uuid4

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.db import utcnow
from app.core.errors import AppError
from app.modules.chat.models import ChatLog
from app.modules.chat.schemas import LogEntry, LogPage


def start(db: Session, conversation: str, question: str, sku: str | None) -> ChatLog:
    row = ChatLog(question_id=str(uuid4()), conversation_id=conversation, question=question, sku=sku)
    db.add(row)
    db.commit()
    return row


def finish(db: Session, row: ChatLog, started: float, result=None, error: str | None = None):
    row.answered_at = utcnow()
    row.duration_ms = round((monotonic() - started) * 1000)
    row.outcome = "error" if error else "answered"
    row.error_code = error
    if result:
        row.answer = result.answer
        row.product_skus = json.dumps([p.sku for p in result.products])
        if row.sku is None and len(result.products) == 1:
            row.sku = result.products[0].sku
    db.commit()


def entry(row: ChatLog) -> LogEntry:
    return LogEntry(
        questionId=row.question_id,
        conversationId=row.conversation_id,
        question=row.question,
        answer=row.answer,
        sku=row.sku,
        receivedAt=row.received_at.replace(tzinfo=UTC) if row.received_at.tzinfo is None else row.received_at,
        answeredAt=(
            row.answered_at.replace(tzinfo=UTC)
            if row.answered_at and row.answered_at.tzinfo is None
            else row.answered_at
        ),
        durationMs=row.duration_ms,
        outcome=row.outcome,
        errorCode=row.error_code,
        reviewedCorrect=row.reviewed_correct,
        cardClicked=row.card_clicked,
    )


def listing(db: Session, offset: int, limit: int, needs_review: bool) -> LogPage:
    filters = [ChatLog.reviewed_correct.is_(None)] if needs_review else []
    rows = db.scalars(select(ChatLog).where(*filters).order_by(ChatLog.id.desc()).offset(offset).limit(limit))
    return LogPage(
        items=[entry(r) for r in rows],
        total=db.scalar(select(func.count()).select_from(ChatLog).where(*filters)) or 0,
    )


def review(db: Session, question_id: str, correct: bool | None) -> LogEntry:
    row = db.scalar(select(ChatLog).where(ChatLog.question_id == question_id))
    if not row:
        raise AppError(404, "chat_question_not_found", "Question not found")
    row.reviewed_correct = correct
    db.commit()
    return entry(row)


def click(db: Session, question_id: str, conversation: str, sku: str):
    row = db.scalar(select(ChatLog).where(ChatLog.question_id == question_id))
    if not row or not secrets.compare_digest(row.conversation_id, conversation):
        raise AppError(404, "chat_question_not_found", "Question not found")
    if sku not in json.loads(row.product_skus):
        raise AppError(422, "chat_card_invalid", "Card is not part of this answer")
    row.card_clicked = True
    db.commit()
