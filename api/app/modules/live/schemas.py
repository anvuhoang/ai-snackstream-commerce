from typing import Literal

from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel


class LiveModel(BaseModel):
    model_config = ConfigDict(
        alias_generator=to_camel,
        populate_by_name=True,
        str_strip_whitespace=True,
        extra="forbid",
    )


class LiveSessionCreate(LiveModel):
    title: str = Field(min_length=1, max_length=160)


class LiveSessionOut(LiveModel):
    live_id: str
    title: str
    is_demo: Literal[True] = True
    status: Literal[
        "not_started",
        "playing",
        "paused",
        "ended",
    ] = "not_started"


class LiveCurrentOut(LiveModel):
    session: LiveSessionOut | None = None
