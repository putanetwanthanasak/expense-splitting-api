"""Group creation and membership business logic (docs/SPEC.md §7, §8.5, §9).

Deliberately independent of FastAPI, same reasoning as app/services/auth.py:
these functions raise plain domain exceptions and let the router map them to
HTTP status codes.
"""

import uuid
from decimal import Decimal

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models.group import Group
from app.models.group_member import GroupMember
from app.models.user import User
from app.services.balances import compute_group_net_balances

ZERO = Decimal("0.00")


class UserNotFoundError(Exception):
    """Raised when adding a member whose user_id does not exist."""


class AlreadyMemberError(Exception):
    """Raised when adding a user who is already a member of the group."""


class MemberNotFoundError(Exception):
    """Raised when removing a user who is not currently a member of the group."""


class MemberHasOutstandingBalanceError(Exception):
    """409: raised when removing a member whose net balance != 0 (§8.1, §9).

    Allowing the removal would make the group's remaining balances stop
    summing to zero -- there'd be no member left to "own" the departing
    member's share of what they paid or are owed. Carries the balance itself
    so the router can put the outstanding amount in the response body.
    """

    def __init__(self, net_balance: Decimal) -> None:
        self.net_balance = net_balance
        super().__init__(f"member has a non-zero net balance: {net_balance}")


def create_group(db: Session, *, name: str, creator_id: uuid.UUID) -> Group:
    """Create a group. The creator becomes a member in the same transaction, so a
    group with zero members is never observable, even transiently.
    """
    group = Group(name=name, created_by_user_id=creator_id)
    db.add(group)
    db.flush()  # assign group.id before the membership row references it
    db.add(GroupMember(group_id=group.id, user_id=creator_id))
    db.commit()
    db.refresh(group)
    return group


def add_member(db: Session, *, group_id: uuid.UUID, user_id: uuid.UUID) -> GroupMember:
    """Add user_id to group_id.

    Raises UserNotFoundError if no such user exists, AlreadyMemberError on a
    duplicate. The duplicate check relies on the `UNIQUE (group_id, user_id)`
    constraint, not a preceding SELECT — "a check is not a lock" (§10.9): two
    concurrent requests adding the same user must not both succeed.
    """
    if db.get(User, user_id) is None:
        raise UserNotFoundError

    member = GroupMember(group_id=group_id, user_id=user_id)
    db.add(member)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise AlreadyMemberError from exc
    db.refresh(member)
    return member


def remove_member(db: Session, *, group_id: uuid.UUID, user_id: uuid.UUID) -> None:
    """Remove user_id from group_id.

    Raises MemberNotFoundError if they weren't a member, MemberHasOutstandingBalanceError
    (409) if their net balance != 0 (§8.1, §9) -- removing them would leave no one
    to own their share of the group's expenses/settlements, breaking the
    sum-to-zero invariant. Both the membership lookup and the balance check run
    against this same session, before the delete this function commits -- not a
    separately-committed check beforehand (§10.9) -- so nothing about this
    removal is visible to any other transaction until everything here has
    validated.

    If net == 0, removal is allowed even when the member has expense history:
    only the group_members row is deleted here. Expense/ExpenseSplit rows
    reference the user directly (paid_by_user_id / user_id), not the membership
    row, so nothing cascades and that history survives intact (§9 "Removing a
    member whose net is 0 but who has expense history -> allowed... history must
    survive").

    Removing the last member is allowed: the group becomes empty but is never
    auto-deleted (see CLAUDE.md "Removing the last member never deletes the
    group") — deleting it would destroy expense history.
    """
    member = (
        db.query(GroupMember)
        .filter(GroupMember.group_id == group_id, GroupMember.user_id == user_id)
        .first()
    )
    if member is None:
        raise MemberNotFoundError

    net_balance = compute_group_net_balances(db, group_id).get(user_id, ZERO)
    if net_balance != ZERO:
        raise MemberHasOutstandingBalanceError(net_balance)

    db.delete(member)
    db.commit()
