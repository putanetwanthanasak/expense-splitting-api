"""Application settings, loaded from environment variables / .env."""

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Central configuration. Values come from .env in local dev, real env vars in CI/prod."""

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    database_url: str
    test_database_url: str = ""

    jwt_secret: str
    jwt_algorithm: str = "HS256"
    access_token_expire_minutes: int = 60

    # Comma-separated list of browser origins allowed to call this API
    # cross-origin (e.g. the deployed frontend). Empty in local dev, where the
    # Vite dev server proxies /api and the request is same-origin. Parsed and
    # applied in app/main.py. Kept as a plain string, not list[str], because
    # pydantic-settings JSON-decodes list-typed env vars and a bare
    # "a,b" value would fail that decode.
    cors_allow_origins: str = ""


settings = Settings()  # type: ignore[call-arg]
