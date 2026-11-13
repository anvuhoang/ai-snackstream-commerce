from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.errors import AppError
from app.modules.chat.models import FAQ, BotSettings, SupportRequest
from app.modules.chat.schemas import BotConfig, FAQEntry, FAQInput, SupportEntry


def config(db: Session) -> BotConfig:
    row = db.get(BotSettings, 1)
    return BotConfig(enabled=row.enabled, contactText=row.contact_text) if row else BotConfig()


def save_config(db: Session, body: BotConfig) -> BotConfig:
    row = db.get(BotSettings, 1)
    if row is None:
        row = BotSettings(id=1)
        db.add(row)
    row.enabled, row.contact_text = body.enabled, body.contactText
    db.commit()
    return config(db)


def faqs(db: Session, approved_only=False) -> list[FAQEntry]:
    query = select(FAQ).order_by(FAQ.id)
    if approved_only:
        query = query.where(FAQ.approved.is_(True))
    return [
        FAQEntry(id=r.id, question=r.question, answer=r.answer, approved=r.approved)
        for r in db.scalars(query)
    ]


def save_faq(db: Session, body: FAQInput, faq_id: int | None = None) -> FAQEntry:
    row = db.get(FAQ, faq_id) if faq_id else FAQ()
    if row is None:
        raise AppError(404, "faq_not_found", "FAQ not found")
    row.question, row.answer, row.approved = body.question, body.answer, body.approved
    db.add(row)
    db.commit()
    return FAQEntry(id=row.id, **body.model_dump())


def delete_faq(db: Session, faq_id: int):
    row = db.get(FAQ, faq_id)
    if row is None:
        raise AppError(404, "faq_not_found", "FAQ not found")
    db.delete(row)
    db.commit()


def support(db: Session, conversation: str):
    return db.scalar(select(SupportRequest).where(SupportRequest.conversation_id == conversation))


def support_entry(row) -> SupportEntry:
    return SupportEntry(id=row.id, conversationId=row.conversation_id, message=row.message, state=row.state)


def request_support(db: Session, conversation: str, message: str):
    row = support(db, conversation)
    if row and row.state != "resolved":
        return support_entry(row)
    if row is None:
        row = SupportRequest(conversation_id=conversation)
        db.add(row)
    row.message, row.state = message, "requested"
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        row = support(db, conversation)
        if row is None:
            raise
    return support_entry(row)


def support_list(db: Session, offset: int, limit: int):
    return [
        support_entry(r)
        for r in db.scalars(
            select(SupportRequest).order_by(SupportRequest.id.desc()).offset(offset).limit(limit)
        )
    ]


def set_support(db: Session, support_id: int, state: str):
    row = db.get(SupportRequest, support_id)
    if row is None:
        raise AppError(404, "support_not_found", "Support request not found")
    allowed = {"requested": {"active", "resolved"}, "active": {"resolved"}, "resolved": set()}
    if state != row.state and state not in allowed[row.state]:
        raise AppError(409, "support_invalid_state", "Invalid support transition")
    row.state = state
    db.commit()
    return support_entry(row)
