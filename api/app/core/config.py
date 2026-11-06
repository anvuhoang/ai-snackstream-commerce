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
    # Browser origin(s) allowed to call the API directly (the web app normally proxies, so this is empty).
    cors_origins: list[str] = Field(default_factory=list, alias="CORS_ORIGINS")

    @model_validator(mode="after")
    def _finalize(self) -> Settings:
        self.database_url = normalize_db_url(self.database_url)
        if self.run_migrations_on_start is None:
            self.run_migrations_on_start = self.env != "production"
        if self.env == "production" and self.secret_key == DEV_SECRET:
            raise ValueError("APP_ENV=production requires SECRET_KEY to be set to a long random value")
        return self

    @property
    def is_prod(self) -> bool:
        return self.env == "production"


@lru_cache
def get_settings() -> Settings:
    return Settings()
