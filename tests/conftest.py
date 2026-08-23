"""Shared pytest fixtures.

Tests run against TEST_DATABASE_URL, never DATABASE_URL. Per docs/SPEC.md §10.7 we
refuse to even start if the target database name doesn't look like a test database —
that's the only thing standing between a typo and truncating the dev/prod database.
"""

from collections.abc import Generator
from decimal import Decimal
from urllib.parse import urlparse

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from app.config import settings
from app.database import Base, _psycopg_url
from app.models import Group, GroupMember
from app.services.balances import compute_group_net_balances


def _assert_is_test_database(url: str) -> None:
    db_name = urlparse(url).path.lstrip("/")
    if "test" not in db_name.lower():
        raise RuntimeError(
            f"Refusing to run tests against database {db_name!r} — its name does not "
            "contain 'test'. Set TEST_DATABASE_URL to a dedicated test database."
        )


if not settings.test_database_url:
    raise RuntimeError("TEST_DATABASE_URL is not set — refusing to run tests.")

_assert_is_test_database(settings.test_database_url)

test_engine = create_engine(_psycopg_url(settings.test_database_url))
TestSessionLocal = sessionmaker(bind=test_engine, autoflush=False, autocommit=False)


@pytest.fixture(scope="session", autouse=True)
def _create_schema() -> Generator[None, None, None]:
    """Create all tables once for the test session, drop them afterwards."""
    Base.metadata.create_all(bind=test_engine)
    yield
    Base.metadata.drop_all(bind=test_engine)


@pytest.fixture
def db_session() -> Generator[Session, None, None]:
    """Per-test transaction rollback (§10.7): every test runs inside a transaction
    that is rolled back at the end, so tests never leak state into one another and
    never need to delete rows by hand.
    """
    connection = test_engine.connect()
    transaction = connection.begin()
    session = TestSessionLocal(bind=connection)

    try:
        yield session
    finally:
        session.close()
        transaction.rollback()
        connection.close()


@pytest.fixture(autouse=True)
def _assert_balances_sum_to_zero(db_session: Session) -> Generator[None, None, None]:
    """§8.1: net balances within a group must sum to exactly 0, always.

    This runs after every single test and walks every group created during that
    test, asserting the invariant holds. It turns the whole suite into an invariant
    test and catches almost every class of bug in this system, rounding errors
    included.
    """
    yield

    group_ids = [row[0] for row in db_session.query(Group.id).all()]
    for group_id in group_ids:
        balances = compute_group_net_balances(db_session, group_id)
        total = sum(balances.values(), start=Decimal("0.00"))
        assert total == Decimal("0.00"), (
            f"group {group_id} balances sum to {total}, not 0.00 — money was "
            "created or destroyed"
        )


__all__ = ["Group", "GroupMember", "test_engine"]
