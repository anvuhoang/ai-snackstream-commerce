"""Application settings, read from environment variables (and an optional .env file)."""

from __future__ import annotations

from functools import lru_cache
from typing import Literal

from pydantic import AliasChoices, Field, SecretStr, model_validator
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
    live_make_enabled: bool = Field(False, alias="LIVE_MAKE_ENABLED")
    live_make_webhook_url: SecretStr = Field(default=SecretStr(""), alias="LIVE_MAKE_WEBHOOK_URL")
    live_make_callback_token: SecretStr = Field(default=SecretStr(""), alias="LIVE_MAKE_CALLBACK_TOKEN")
    live_ffprobe_path: str = Field("ffprobe", min_length=1, alias="LIVE_FFPROBE_PATH")
    live_make_result_timeout_seconds: float = Field(
        180,
        gt=0,
        le=1800,
        allow_inf_nan=False,
        alias="LIVE_MAKE_RESULT_TIMEOUT_SECONDS",
    )
    live_mock_enabled: bool = Field(False, alias="LIVE_MOCK_ENABLED")
    live_mock_video_duration_seconds: float = Field(
        10.077007,
        gt=0,
        le=300,
        allow_inf_nan=False,
        alias="LIVE_MOCK_VIDEO_DURATION_SECONDS",
    )
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
    # Odoo (stock source). Empty = stock is kept only in our own tables. Uses Odoo's JSON-2 API with an API key.
    odoo_url: str = Field("", alias="ODOO_URL")
    # ODOO_DATABASE is accepted too: the chatbot used that name first.
    odoo_db: str = Field("", validation_alias=AliasChoices("ODOO_DB", "ODOO_DATABASE"))
    odoo_api_key: str = Field("", alias="ODOO_API_KEY")
    odoo_timeout_s: float = Field(20.0, alias="ODOO_TIMEOUT_S", gt=0)
    # A count copied from Odoo older than this many minutes is shown as "unknown, contact the shop" and cannot be added to a cart.
    # 0 = never expire (the last synced number is used).
    stock_stale_minutes: int = Field(0, alias="STOCK_STALE_MINUTES", ge=0)

    # The chatbot reads products over XML-RPC and needs the login too (it shares ODOO_URL, ODOO_DB and ODOO_API_KEY above).
    odoo_login: str = ""
    chat_public_skus: list[str] = Field(default_factory=list)
    chat_all_sale_products: bool = False
    gemini_api_key: str = ""
    gemini_model: Literal["gemini-3.1-flash-lite"] = "gemini-3.1-flash-lite"
    gemini_free_tier_confirmed: bool = False

    @model_validator(mode="after")
    def _finalize(self) -> Settings:
        if self.live_make_enabled and self.live_mock_enabled:
            raise ValueError("Enable only one of LIVE_MAKE_ENABLED and LIVE_MOCK_ENABLED")
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
    def odoo_database(self) -> str:
        return self.odoo_db  # the chatbot's name for the same setting

    @property
    def odoo_enabled(self) -> bool:
        return bool(self.odoo_url and self.odoo_db and self.odoo_api_key)

    @property
    def is_prod(self) -> bool:
        return self.env == "production"


@lru_cache
def get_settings() -> Settings:
    return Settings()
