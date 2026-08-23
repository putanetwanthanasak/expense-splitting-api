"""Live balance computation. See docs/SPEC.md §3 and §4.

Balances are recomputed from expenses + settlements on every read — there is
deliberately no `balances` table (see the comment in app/models/__init__.py for why).
This module is allowed to depend on SQLAlchemy; unlike app/services/splitting.py it
is not required to stay pure, since it has to query the database to do its job.
"""

import uuid
from decimal import Decimal

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.models.expense import Expense
from app.models.expense_split import ExpenseSplit
from app.models.group_member import GroupMember
from app.models.settlement import Settlement

ZERO = Decimal("0.00")


def compute_group_net_balances(db: Session, group_id: uuid.UUID) -> dict[uuid.UUID, Decimal]:
    """net(u) = paid − owed + settlements_paid − settlements_received.

    Returns one entry per *current* member of the group (§7: GET /groups/{id}/balances
    is per-member). A member removed earlier must have already had net == 0 (§9,
    edge case "Removing a member whose net balance != 0 -> 409"), so omitting their
    historical rows here does not change the total — the sum-to-zero invariant
    (§8.1) still holds.
    """
    member_ids = [
        row[0]
        for row in db.query(GroupMember.user_id).filter(GroupMember.group_id == group_id).all()
    ]
    balances: dict[uuid.UUID, Decimal] = dict.fromkeys(member_ids, ZERO)
    if not member_ids:
        return balances

    paid = (
        db.query(Expense.paid_by_user_id, func.sum(Expense.amount))
        .filter(Expense.group_id == group_id)
        .group_by(Expense.paid_by_user_id)
        .all()
    )
    for user_id, total in paid:
        if user_id in balances:
            balances[user_id] += Decimal(total)

    owed = (
        db.query(ExpenseSplit.user_id, func.sum(ExpenseSplit.amount_owed))
        .join(Expense, Expense.id == ExpenseSplit.expense_id)
        .filter(Expense.group_id == group_id)
        .group_by(ExpenseSplit.user_id)
        .all()
    )
    for user_id, total in owed:
        if user_id in balances:
            balances[user_id] -= Decimal(total)

    settled_out = (
        db.query(Settlement.from_user_id, func.sum(Settlement.amount))
        .filter(Settlement.group_id == group_id)
        .group_by(Settlement.from_user_id)
        .all()
    )
    for user_id, total in settled_out:
        if user_id in balances:
            balances[user_id] += Decimal(total)

    settled_in = (
        db.query(Settlement.to_user_id, func.sum(Settlement.amount))
        .filter(Settlement.group_id == group_id)
        .group_by(Settlement.to_user_id)
        .all()
    )
    for user_id, total in settled_in:
        if user_id in balances:
            balances[user_id] -= Decimal(total)

    return balances
