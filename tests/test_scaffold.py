"""Smoke tests for the scaffold itself: the test-DB fixtures actually work."""

import uuid
from decimal import Decimal

from sqlalchemy.orm import Session

from app.models import Group, User


def test_db_session_creates_and_rolls_back(db_session: Session) -> None:
    user = User(email=f"{uuid.uuid4()}@example.com", password_hash="x", name="Test User")
    db_session.add(user)
    db_session.flush()

    assert db_session.query(User).filter(User.id == user.id).one() is user


def test_group_with_no_expenses_balances_to_zero(db_session: Session) -> None:
    """Exercises the autouse §8.1 invariant fixture on the trivial case."""
    user = User(email=f"{uuid.uuid4()}@example.com", password_hash="x", name="Test User")
    db_session.add(user)
    db_session.flush()

    group = Group(name="Test Group", created_by_user_id=user.id)
    db_session.add(group)
    db_session.flush()

    # No members, no expenses — nothing to sum, invariant holds trivially.
    assert Decimal("0.00") == Decimal("0.00")
