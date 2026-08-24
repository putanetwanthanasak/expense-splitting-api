"""Group creation and membership business logic (docs/SPEC.md §7, §8.5, §9).

Deliberately independent of FastAPI, same reasoning as app/services/auth.py:
these functions raise plain domain exceptions and let the router map them to
HTTP status codes.
"""

import uuid

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models.group import Group
from app.models.group_member import GroupMember
from app.models.user import User


class UserNotFoundError(Exception):
    """Raised when adding a member whose user_id does not exist."""


class AlreadyMemberError(Exception):
    """Raised when adding a user who is already a member of the group."""


class MemberNotFoundError(Exception):
    """Raised when removing a user who is not currently a member of the group."""


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
    """Remove user_id from group_id. Raises MemberNotFoundError if they weren't a
    member.

    TODO(§9 "Group membership"): once balances exist (Phase 8), a member with a
    non-zero net balance must not be removable — that must become a 409 stating
    the outstanding amount. There are no expenses/settlements yet in this phase,
    so every current member's balance is trivially 0 and removal is always safe.

    Removing the last member is allowed: the group becomes empty but is never
    auto-deleted (see CLAUDE.md "Removing the last member never deletes the
    group") — deleting it would destroy expense history.
    """
    deleted = (
        db.query(GroupMember)
        .filter(GroupMember.group_id == group_id, GroupMember.user_id == user_id)
        .delete()
    )
    if deleted == 0:
        db.rollback()
        raise MemberNotFoundError
    db.commit()
