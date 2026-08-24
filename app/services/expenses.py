"""Expense CRUD business logic (docs/SPEC.md §7, §8.2, §8.6, §9).

Every split calculation is delegated to app/services/splitting.py -- this module
never recomputes a share itself; if the maths needs to change, it changes there
and nowhere else. What lives here instead is everything splitting.py can't see
because it only takes plain Decimals and UUIDs: which participants are actually
members of the group, whether a participant id is duplicated in the request, and
turning a validated request into ORM rows inside one transaction.
"""

import uuid
from datetime import date
from decimal import Decimal

from sqlalchemy.orm import Session

from app.models.enums import SplitType
from app.models.expense import Expense
from app.models.expense_split import ExpenseSplit
from app.models.group_member import GroupMember
from app.services.splitting import (
    split_by_percentage,
    split_by_shares,
    split_equally,
    split_exact,
)

__all__ = [
    "ExpenseNotFoundError",
    "ExpenseValidationError",
    "create_expense",
    "delete_expense",
    "get_expense",
    "list_group_expenses",
    "update_expense",
]


class ExpenseValidationError(Exception):
    """400: a non-positive amount, a duplicated participant, or a payer/
    participant who isn't a member of the group. Distinct from splitting.py's
    own SplitValidationError (bad EXACT sum, PERCENTAGE not summing to 100, a
    non-positive SHARES count) -- routers must catch both and map both to 400,
    since both describe an invalid expense request, just from different layers.
    """


class ExpenseNotFoundError(Exception):
    """404: no expense with this id."""


def _group_member_ids(db: Session, group_id: uuid.UUID) -> set[uuid.UUID]:
    return {
        row[0]
        for row in db.query(GroupMember.user_id).filter(GroupMember.group_id == group_id).all()
    }


def _validate_and_compute_splits(
    split_type: SplitType,
    amount: Decimal,
    member_ids: set[uuid.UUID],
    *,
    participant_user_ids: list[uuid.UUID] | None,
    exact_amounts: list[tuple[uuid.UUID, Decimal]] | None,
    percentages: list[tuple[uuid.UUID, Decimal]] | None,
    shares: list[tuple[uuid.UUID, Decimal]] | None,
) -> dict[uuid.UUID, Decimal]:
    """Validate participants (unique, all group members) and compute the split.

    EXACT/PERCENTAGE/SHARES arrive here as ordered (user_id, value) pairs, not
    already a dict -- a dict comprehension would silently collapse a duplicated
    user_id before splitting.py's Mapping-typed inputs ever got a chance to see
    it, hiding exactly the bug §9 ("the same participant listed twice -> 400")
    exists to catch. Checking uniqueness on the raw pairs first, before any dict
    is built, is what makes that check possible.

    Exactly one of the four keyword arguments is used, chosen by split_type; the
    router is responsible for supplying the one that matches (each request
    schema variant only exposes the field for its own split_type), so a mismatch
    here is a bug in the router, not a user error -- hence AssertionError rather
    than ExpenseValidationError.
    """
    if split_type is SplitType.EQUAL:
        if participant_user_ids is None:
            raise AssertionError("EQUAL split requires participant_user_ids")
        ordered_ids = participant_user_ids
    elif split_type is SplitType.EXACT:
        if exact_amounts is None:
            raise AssertionError("EXACT split requires exact_amounts")
        ordered_ids = [user_id for user_id, _ in exact_amounts]
    elif split_type is SplitType.PERCENTAGE:
        if percentages is None:
            raise AssertionError("PERCENTAGE split requires percentages")
        ordered_ids = [user_id for user_id, _ in percentages]
    else:
        if shares is None:
            raise AssertionError("SHARES split requires shares")
        ordered_ids = [user_id for user_id, _ in shares]

    if len(set(ordered_ids)) != len(ordered_ids):
        raise ExpenseValidationError("duplicate participant in request")

    outsiders = sorted(str(uid) for uid in set(ordered_ids) if uid not in member_ids)
    if outsiders:
        raise ExpenseValidationError(
            "participant(s) not in this group: " + ", ".join(outsiders)
        )

    # Only now, once the raw input has passed validation, does anything become a
    # dict -- collapsing duplicates is safe at this point because there are none.
    if split_type is SplitType.EQUAL:
        return split_equally(amount, ordered_ids)
    if split_type is SplitType.EXACT:
        assert exact_amounts is not None
        return split_exact(amount, dict(exact_amounts))
    if split_type is SplitType.PERCENTAGE:
        assert percentages is not None
        return split_by_percentage(amount, dict(percentages))
    assert shares is not None
    return split_by_shares(amount, dict(shares))


def _persist_splits(db: Session, expense: Expense, splits: dict[uuid.UUID, Decimal]) -> None:
    """Write `splits` as ExpenseSplit rows for `expense` and commit -- but only
    if they sum to expense.amount exactly (§8.2). splitting.py already
    guarantees this before ever returning `splits`; asserting it again here,
    in application code, right before the write that would actually persist a
    broken split, means a future bug that weakens that guarantee still can't
    reach the database silently -- it rolls back instead of committing.
    """
    total = sum(splits.values(), start=Decimal("0.00"))
    if total != expense.amount:
        db.rollback()
        raise AssertionError(
            f"expense splits sum to {total}, not amount {expense.amount} -- refusing "
            "to persist (a bug in splitting.py, not bad user input, which would "
            "already have raised SplitValidationError before reaching here)"
        )

    for user_id, amount_owed in splits.items():
        db.add(ExpenseSplit(expense_id=expense.id, user_id=user_id, amount_owed=amount_owed))

    db.commit()
    db.refresh(expense)


def create_expense(
    db: Session,
    *,
    group_id: uuid.UUID,
    paid_by_user_id: uuid.UUID,
    amount: Decimal,
    description: str,
    expense_date: date,
    split_type: SplitType,
    participant_user_ids: list[uuid.UUID] | None = None,
    exact_amounts: list[tuple[uuid.UUID, Decimal]] | None = None,
    percentages: list[tuple[uuid.UUID, Decimal]] | None = None,
    shares: list[tuple[uuid.UUID, Decimal]] | None = None,
) -> Expense:
    """Create an expense and its splits in one transaction.

    Group membership is checked against the same session that performs the
    insert below, with a single commit at the end -- not a separate,
    already-committed check beforehand (§10.9): nothing about this expense is
    visible to any other transaction until everything here has validated.
    """
    if amount <= 0:
        raise ExpenseValidationError("amount must be positive")

    member_ids = _group_member_ids(db, group_id)
    if paid_by_user_id not in member_ids:
        raise ExpenseValidationError("paid_by_user_id is not a member of this group")

    splits = _validate_and_compute_splits(
        split_type,
        amount,
        member_ids,
        participant_user_ids=participant_user_ids,
        exact_amounts=exact_amounts,
        percentages=percentages,
        shares=shares,
    )

    expense = Expense(
        group_id=group_id,
        paid_by_user_id=paid_by_user_id,
        amount=amount,
        description=description,
        expense_date=expense_date,
        split_type=split_type,
    )
    db.add(expense)
    db.flush()  # assign expense.id before the split rows reference it

    _persist_splits(db, expense, splits)
    return expense


def update_expense(
    db: Session,
    *,
    expense_id: uuid.UUID,
    paid_by_user_id: uuid.UUID,
    amount: Decimal,
    description: str,
    expense_date: date,
    split_type: SplitType,
    participant_user_ids: list[uuid.UUID] | None = None,
    exact_amounts: list[tuple[uuid.UUID, Decimal]] | None = None,
    percentages: list[tuple[uuid.UUID, Decimal]] | None = None,
    shares: list[tuple[uuid.UUID, Decimal]] | None = None,
) -> Expense:
    """Replace an expense's fields and every one of its splits (§9: "PATCH ->
    delete all existing splits and recreate them, in one transaction. Never
    update rows individually."). The expense's group is not editable via PATCH.
    """
    expense = db.get(Expense, expense_id)
    if expense is None:
        raise ExpenseNotFoundError

    if amount <= 0:
        raise ExpenseValidationError("amount must be positive")

    member_ids = _group_member_ids(db, expense.group_id)
    if paid_by_user_id not in member_ids:
        raise ExpenseValidationError("paid_by_user_id is not a member of this group")

    splits = _validate_and_compute_splits(
        split_type,
        amount,
        member_ids,
        participant_user_ids=participant_user_ids,
        exact_amounts=exact_amounts,
        percentages=percentages,
        shares=shares,
    )

    # Delete-then-recreate, never a row-by-row update, and all inside the one
    # transaction this function commits at the end via _persist_splits.
    db.query(ExpenseSplit).filter(ExpenseSplit.expense_id == expense.id).delete()

    expense.paid_by_user_id = paid_by_user_id
    expense.amount = amount
    expense.description = description
    expense.expense_date = expense_date
    expense.split_type = split_type

    _persist_splits(db, expense, splits)
    return expense


def get_expense(db: Session, expense_id: uuid.UUID) -> Expense:
    expense = db.get(Expense, expense_id)
    if expense is None:
        raise ExpenseNotFoundError
    return expense


def list_group_expenses(
    db: Session, group_id: uuid.UUID, *, limit: int, offset: int
) -> tuple[list[Expense], int]:
    """Paginated, most recent expense_date first. Returns (page, total_count) so
    the caller can build a pagination response without a second round trip.
    """
    query = db.query(Expense).filter(Expense.group_id == group_id)
    total = query.count()
    items = (
        query.order_by(Expense.expense_date.desc(), Expense.created_at.desc(), Expense.id)
        .offset(offset)
        .limit(limit)
        .all()
    )
    return items, total


def delete_expense(db: Session, expense_id: uuid.UUID) -> None:
    """Delete an expense. Its splits cascade with it at the database level (§9)
    -- see the ondelete="CASCADE" on ExpenseSplit.expense_id.
    """
    expense = db.get(Expense, expense_id)
    if expense is None:
        raise ExpenseNotFoundError
    db.delete(expense)
    db.commit()
