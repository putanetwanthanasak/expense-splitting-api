"""Settlement recording business logic (docs/SPEC.md §7, §8.7, §9).

A settlement is only a record that a repayment happened offline (§1) -- this
module never moves money anywhere, it just writes the row that
app/services/balances.py's live computation will pick up on the next read.
"""

import uuid
from decimal import Decimal

from sqlalchemy.orm import Session

from app.models.group_member import GroupMember
from app.models.settlement import Settlement
from app.services.balances import compute_group_net_balances

__all__ = [
    "SettlementValidationError",
    "list_group_settlements",
    "record_settlement",
]

ZERO = Decimal("0.00")


class SettlementValidationError(Exception):
    """400: a non-positive amount, from_user_id == to_user_id (defense in depth
    behind the Pydantic-level check on SettlementCreate -- §8.7 says never rely
    on the database CHECK constraint alone, and the same reasoning extends to
    not relying on the Pydantic layer alone either), or either user isn't a
    member of this group.
    """


def record_settlement(
    db: Session,
    *,
    group_id: uuid.UUID,
    from_user_id: uuid.UUID,
    to_user_id: uuid.UUID,
    amount: Decimal,
) -> tuple[Settlement, str | None]:
    """Record a repayment from from_user_id to to_user_id.

    Returns (settlement, warning). warning is None unless from_user_id paid
    more than they currently owed overall (§9 "Paying more than owed ->
    allowed... but return a warning field"), in which case it explains that
    they are now a net creditor. "What they currently owe" is read from the
    same live balance computation used everywhere else (§8.4) -- there is no
    separate stored notion of a pairwise debt to compare against.

    Membership and the balance snapshot behind the warning are both read
    against this same session, before the insert this function commits --
    not a separately-committed check beforehand (§10.9).
    """
    if amount <= ZERO:
        raise SettlementValidationError("amount must be positive")
    if from_user_id == to_user_id:
        raise SettlementValidationError("from_user_id and to_user_id must differ")

    member_ids = {
        row[0]
        for row in db.query(GroupMember.user_id).filter(GroupMember.group_id == group_id).all()
    }
    if from_user_id not in member_ids or to_user_id not in member_ids:
        raise SettlementValidationError(
            "from_user_id and to_user_id must both be members of this group"
        )

    balances_before = compute_group_net_balances(db, group_id)
    owed_by_payer = max(ZERO, -balances_before.get(from_user_id, ZERO))
    warning = None
    if amount > owed_by_payer:
        warning = (
            f"{from_user_id} paid {amount}, more than the {owed_by_payer} they owed "
            "in this group -- they are now a net creditor."
        )

    settlement = Settlement(
        group_id=group_id, from_user_id=from_user_id, to_user_id=to_user_id, amount=amount
    )
    db.add(settlement)
    db.commit()
    db.refresh(settlement)
    return settlement, warning


def list_group_settlements(db: Session, group_id: uuid.UUID) -> list[Settlement]:
    """Settlement history for a group, newest first (§7)."""
    return (
        db.query(Settlement)
        .filter(Settlement.group_id == group_id)
        .order_by(Settlement.settled_at.desc(), Settlement.id.desc())
        .all()
    )
