"""Application settings, read from environment variables (and an optional .env file)."""

from __future__ import annotations

from functools import lru_cache
from typing import Literal

from pydantic import Field, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

DEV_SECRET = "dev-only-change-me"


def normalize_db_url(url: str) -> str:
    """Hosting providers hand out postgres:// or postgresql://; SQLAlchemy needs the psycopg 3 driver name."""
    for prefix in ("postgres://", "postgresql://"):
        if url.startswith(prefix):
            return "postgresql+psycopg://" + url[len(prefix) :]
    return url


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore", populate_by_name=True)

    env: Literal["dev", "test", "production"] = Field("dev", alias="APP_ENV")
    database_url: str = Field("sqlite:///./snackstream_dev.db", alias="DATABASE_URL")
    secret_key: str = Field(DEV_SECRET, alias="SECRET_KEY")
    session_max_age: int = Field(12 * 60 * 60, alias="SESSION_MAX_AGE")
    # In production, run `alembic upgrade head` as a deploy step instead of at app start.
    run_migrations_on_start: bool | None = Field(None, alias="RUN_MIGRATIONS_ON_START")
    # Dev convenience: create this admin on first start if no admin exists yet.
    bootstrap_admin_email: str = Field("", alias="BOOTSTRAP_ADMIN_EMAIL")
    bootstrap_admin_password: str = Field("", alias="BOOTSTRAP_ADMIN_PASSWORD")
    media_dir: str = Field("./media", alias="MEDIA_DIR")
    max_upload_bytes: int = Field(5 * 1024 * 1024, alias="MAX_UPLOAD_BYTES")
    # Opt-in: create the labelled demo catalog at start-up (idempotent). Handy on hosts without a shell.
    seed_demo_catalog: bool = Field(False, alias="SEED_DEMO_CATALOG")
    # Browser origin(s) allowed to call the API directly (the web app normally proxies, so this is empty).
    cors_origins: list[str] = Field(default_factory=list, alias="CORS_ORIGINS")
    # Shipping (decision D4): a flat fee, free from a threshold. Money is whole dong.
    shipping_fee_vnd: int = Field(30_000, alias="SHIPPING_FEE_VND", ge=0)
    free_ship_from_vnd: int = Field(300_000, alias="FREE_SHIP_FROM_VND", ge=0)
    # An unpaid online order keeps its stock only this long, then it is cancelled and the stock released.
    order_expiry_minutes: int = Field(15, alias="ORDER_EXPIRY_MINUTES", ge=1)
    # VNPay sandbox (https://sandbox.vnpayment.vn). Empty = online payment is switched off and only COD is offered.
    vnpay_tmn_code: str = Field("", alias="VNPAY_TMN_CODE")
    vnpay_hash_secret: str = Field("", alias="VNPAY_HASH_SECRET")
    vnpay_url: str = Field("https://sandbox.vnpayment.vn/paymentv2/vpcpay.html", alias="VNPAY_URL")
    # Where VNPay sends the customer's browser back to (a page of the web app).
    vnpay_return_url: str = Field("http://localhost:3000/checkout/result", alias="VNPAY_RETURN_URL")

    @model_validator(mode="after")
    def _finalize(self) -> Settings:
        self.database_url = normalize_db_url(self.database_url)
        if self.run_migrations_on_start is None:
            self.run_migrations_on_start = self.env != "production"
        if self.env == "production" and self.secret_key == DEV_SECRET:
            raise ValueError("APP_ENV=production requires SECRET_KEY to be set to a long random value")
        return self

    @property
    def vnpay_enabled(self) -> bool:
        return bool(self.vnpay_tmn_code and self.vnpay_hash_secret)

    @property
    def is_prod(self) -> bool:
        return self.env == "production"


@lru_cache
def get_settings() -> Settings:
    return Settings()
