"""Request and response models for the back-office stock screens (camelCase on the wire)."""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import Field, model_validator

from app.core.schemas import ApiModel

StockState = Literal["untracked", "out", "low"]


class StockRow(ApiModel):
    variant_id: int
    sku: str
    product_name: str
    variant_name: str
    tracked: bool
    source: Literal["own", "odoo"] | None
    on_hand: int
    reserved: int
    available: int
    updated_at: datetime | None
    synced_at: datetime | None


class StockPage(ApiModel):
    items: list[StockRow]
    page: int
    page_size: int
    total: int
    low_stock_at: int


class StockAdjust(ApiModel):
    """`receive` adds new goods (positive). `adjust` corrects the count after checking the shelf (either sign)."""

    kind: Literal["receive", "adjust"]
    delta: int = Field(ge=-100_000, le=100_000)
    note: str = Field("", max_length=500)

    @model_validator(mode="after")
    def _check(self) -> StockAdjust:
        if self.delta == 0:
            raise ValueError("The change cannot be zero.")
        if self.kind == "receive" and self.delta < 0:
            raise ValueError("Received goods must be a positive number. Use a correction to remove units.")
        return self


class MovementOut(ApiModel):
    id: int
    kind: str
    delta_on_hand: int
    delta_reserved: int
    order_code: str | None
    actor_email: str | None
    note: str
    created_at: datetime


class SyncRunOut(ApiModel):
    started_at: datetime
    finished_at: datetime | None
    ok: bool
    matched: int
    changed: int
    missing_skus: list[str]
    error: str


class SyncStatus(ApiModel):
    enabled: bool
    last_run: SyncRunOut | None
