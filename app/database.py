"""SQLAlchemy engine and session factory. Sync, not async — see docs/SPEC.md §2."""

from collections.abc import Generator

from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from app.config import settings


def _psycopg_url(url: str) -> str:
    """Normalize a Postgres URL to the psycopg3 driver regardless of how it was
    written. Managed hosts (Render, Heroku, Railway) inject a `postgres://` URL,
    which SQLAlchemy 2.0 no longer recognizes; local `.env` uses `postgresql://`.
    Both are rewritten to `postgresql+psycopg://`.
    """
    if url.startswith("postgres://"):
        return url.replace("postgres://", "postgresql+psycopg://", 1)
    if url.startswith("postgresql://"):
        return url.replace("postgresql://", "postgresql+psycopg://", 1)
    return url


engine = create_engine(_psycopg_url(settings.database_url), pool_pre_ping=True)

SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)


class Base(DeclarativeBase):
    """Declarative base for all ORM models."""


def get_db() -> Generator[Session, None, None]:
    """FastAPI dependency: yields a request-scoped session, always closed after use."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
