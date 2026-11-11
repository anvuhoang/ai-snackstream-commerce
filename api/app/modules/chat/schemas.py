from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field


class Message(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(min_length=1, max_length=2000)


class ChatRequest(BaseModel):
    message: str = Field(min_length=1, max_length=2000)
    history: list[Message] = Field(default_factory=list, max_length=10)
    sku: str | None = Field(None, max_length=100)


class Product(BaseModel):
    sku: str
    name: str
    price: float
    currency: str
    image_url: str | None = None
    product_url: str | None = None
    sales_description: str | None = None
    on_hand: float | None = None
    available: float | None = None
    stock_unit: str | None = None
    stock_checked_at: datetime | None = None


class ChatResponse(BaseModel):
    answer: str
    products: list[Product]
    questionId: str | None = None


class LogEntry(BaseModel):
    questionId: str
    conversationId: str
    question: str
    answer: str | None
    sku: str | None
    receivedAt: datetime
    answeredAt: datetime | None
    durationMs: int | None
    outcome: str
    errorCode: str | None
    reviewedCorrect: bool | None
    cardClicked: bool


class LogPage(BaseModel):
    items: list[LogEntry]
    total: int


class ReviewRequest(BaseModel):
    reviewedCorrect: bool | None


class CardClick(BaseModel):
    sku: str = Field(min_length=1, max_length=100)


class BotConfig(BaseModel):
    enabled: bool = True
    contactText: str = Field(
        "Vui lòng liên hệ cửa hàng qua kênh hỗ trợ đã công bố.", min_length=1, max_length=1000
    )


class FAQInput(BaseModel):
    question: str = Field(min_length=1, max_length=500)
    answer: str = Field(min_length=1, max_length=4000)
    approved: bool = False


class FAQEntry(FAQInput):
    id: int


class SupportInput(BaseModel):
    message: str = Field(min_length=1, max_length=2000)


class SupportState(BaseModel):
    state: Literal["requested", "active", "resolved"]


class SupportEntry(SupportState):
    id: int
    conversationId: str
    message: str


class PublicStatus(BotConfig):
    supportState: Literal["requested", "active", "resolved"] | None = None
