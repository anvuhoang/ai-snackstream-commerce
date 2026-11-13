from datetime import UTC, datetime
from typing import Annotated, Literal, Self

from pydantic import BaseModel, ConfigDict, Field, HttpUrl, field_validator, model_validator
from pydantic.alias_generators import to_camel


class LiveModel(BaseModel):
    model_config = ConfigDict(
        alias_generator=to_camel,
        populate_by_name=True,
        str_strip_whitespace=True,
        extra="forbid",
    )


Sku = Annotated[str, Field(pattern=r"^[A-Za-z0-9][A-Za-z0-9_-]{1,38}$")]


class LiveScriptSegment(LiveModel):
    name: str = Field(min_length=1, max_length=160)
    sku: Sku
    video_url: HttpUrl
    duration_seconds: float = Field(strict=True, gt=0, le=3600, allow_inf_nan=False)

    @field_validator("sku")
    @classmethod
    def uppercase_sku(cls, value: str) -> str:
        return value.upper()

    @field_validator("video_url")
    @classmethod
    def no_credentials(cls, value: HttpUrl) -> HttpUrl:
        if value.username is not None or value.password is not None:
            raise ValueError("Video URL must not contain credentials.")
        return value


class LiveSessionCreate(LiveModel):
    title: str = Field(min_length=1, max_length=160)
    scheduled_skus: list[Sku] = Field(min_length=1, max_length=6)
    script_playlist: list[LiveScriptSegment] = Field(default_factory=list, max_length=30)

    @model_validator(mode="after")
    def playlist_skus(self) -> Self:
        if any(segment.sku not in self.scheduled_skus for segment in self.script_playlist):
            raise ValueError("Every script SKU must be scheduled for this session.")
        return self

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
    kind: Literal["script", "reply"] = "script"
    media_source: Literal["prerecorded", "make", "playlist"] = "prerecorded"
    script_index: int | None = Field(default=None, ge=0)
    script_name: str | None = None
    question_id: str | None = None
    duration_seconds: float | None = Field(
        default=None,
        gt=0,
        le=3600,
        allow_inf_nan=False,
    )


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
    status: Literal["queued", "processing", "ready", "answering", "answered", "failed", "skipped"] = "queued"
    processing_started_at: datetime | None = None
    result_received_at: datetime | None = None
    reply_text: str | None = None
    video_url: str | None = None
    media_source: Literal["prerecorded", "make"] | None = None
    video_duration_seconds: float | None = Field(default=None, gt=0, le=300, allow_inf_nan=False)
    provider_talk_id: str | None = None
    error_code: str | None = None
    is_demo: Literal[True] = True
    source: Literal["web_live"] = "web_live"


class LiveSessionOut(LiveModel):
    live_id: str
    title: str
    scheduled_skus: list[str]
    pinned_sku: str
    script_playlist: list[LiveScriptSegment] = Field(default_factory=list)
    script_completed: bool = False
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


class LiveMakeResultIn(LiveModel):
    live_id: ClientId
    question_id: ClientId
    sku: Sku
    status: Literal["ready", "failed", "skipped"]
    reply_text: str | None = Field(default=None, max_length=1500)
    video_url: HttpUrl | None = None
    duration_seconds: float | None = Field(
        default=None,
        strict=True,
        gt=0,
        le=300,
        allow_inf_nan=False,
        description=(
            "Measured duration of the actual rendered video in seconds. Required for ready; "
            "must be absent or null for failed/skipped. Never infer from text or demo media."
        ),
    )
    provider_talk_id: str | None = Field(default=None, min_length=1, max_length=160)
    error_code: (
        Literal[
            "unsupported_intent",
            "product_not_found",
            "generation_failed",
            "generation_timeout",
        ]
        | None
    ) = None

    @field_validator("sku")
    @classmethod
    def uppercase_sku(cls, value: str) -> str:
        return value.upper()

    @field_validator("video_url")
    @classmethod
    def https_video_url(cls, value: HttpUrl | None) -> HttpUrl | None:
        if value is not None and (
            value.scheme != "https" or value.username is not None or value.password is not None
        ):
            raise ValueError("Video URL must use HTTPS without embedded credentials.")
        return value

    @model_validator(mode="after")
    def check_result_fields(self) -> Self:
        if self.status == "ready":
            if (
                self.video_url is None
                or self.duration_seconds is None
                or not self.reply_text
                or self.error_code is not None
            ):
                raise ValueError(
                    "Ready results require HTTPS video URL, measured durationSeconds, "
                    "reply text, and no error code."
                )
        elif self.error_code is None or self.video_url is not None or self.duration_seconds is not None:
            raise ValueError("Failed or skipped results require an error code and no video URL or duration.")
        return self


class LiveMediaMetadataOut(LiveModel):
    duration_seconds: float = Field(gt=0, le=300, allow_inf_nan=False)


class LiveMakeResultAck(LiveModel):
    received: Literal[True] = True
    applied: bool
    reason: Literal[
        "accepted",
        "duplicate",
        "stale_session",
        "session_ended",
        "question_skipped",
    ]
