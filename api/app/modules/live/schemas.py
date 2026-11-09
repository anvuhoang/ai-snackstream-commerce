from datetime import UTC, datetime
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator
from pydantic.alias_generators import to_camel


class LiveModel(BaseModel):
    model_config = ConfigDict(
        alias_generator=to_camel,
        populate_by_name=True,
        str_strip_whitespace=True,
        extra="forbid",
    )


Sku = Annotated[str, Field(pattern=r"^[A-Za-z0-9][A-Za-z0-9_-]{1,38}$")]


class LiveSessionCreate(LiveModel):
    title: str = Field(min_length=1, max_length=160)
    scheduled_skus: list[Sku] = Field(min_length=1, max_length=6)

    @field_validator("scheduled_skus")
    @classmethod
    def unique_skus(cls, values: list[str]) -> list[str]:
        skus = [sku.upper() for sku in values]
        if len(skus) != len(set(skus)):
            raise ValueError("Scheduled SKUs must be unique.")
        return skus

class LivePlaybackOut(LiveModel):
    playback_id: str
    video_url: str
    started_at: datetime
    paused_at: datetime | None = None

ClientId = Annotated[str, Field(pattern=r"^[A-Za-z0-9_-]{8,80}$")]


class LiveQuestionIn(LiveModel):
    question_id: ClientId
    session_id: ClientId
    text: str = Field(min_length=1, max_length=500)


class LiveQuestionOut(LiveModel):
    question_id: str
    live_id: str
    text: str
    sku: str
    received_at: datetime
    status: Literal["queued", "skipped"] = "queued"
    is_demo: Literal[True] = True
    source: Literal["web_live"] = "web_live"

class LiveSessionOut(LiveModel):
    live_id: str
    title: str
    scheduled_skus: list[str]
    pinned_sku: str
    is_demo: Literal[True] = True
    status: Literal[
        "not_started",
        "playing",
        "paused",
        "ended",
    ] = "not_started"
    playback: LivePlaybackOut | None = None
    questions: list[LiveQuestionOut] = Field(default_factory=list)

class LiveCurrentOut(LiveModel):
    session: LiveSessionOut | None = None
    server_time: datetime = Field(default_factory=lambda: datetime.now(UTC))

class LivePinIn(LiveModel):
    sku: Sku

    @field_validator("sku")
    @classmethod
    def uppercase_sku(cls, value: str) -> str:
        return value.upper()