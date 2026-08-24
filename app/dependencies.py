"""FastAPI dependencies shared across routers."""

import uuid
from typing import Annotated

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.expense import Expense
from app.models.group import Group
from app.models.group_member import GroupMember
from app.models.user import User
from app.services.security import InvalidTokenError, decode_access_token

DbSession = Annotated[Session, Depends(get_db)]

# auto_error=False: FastAPI's HTTPBearer raises 403 by default when the
# Authorization header is missing. That conflates "not authenticated" with
# "authenticated but not permitted" (§10.2) — a missing token must be 401, so we
# disable the built-in auto-error and raise 401 ourselves below.
_bearer_scheme = HTTPBearer(auto_error=False)

# One generic message for every way a token can be unusable — missing, expired,
# malformed, or signed with the wrong key — for the same reason §10.4 asks for a
# single login-failure message: telling the caller *which* thing was wrong about
# their token is a gift to an attacker, not a UX nicety.
_INVALID_TOKEN_MESSAGE = "Could not validate credentials"


def get_current_user(
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(_bearer_scheme)],
    db: DbSession,
) -> User:
    """Resolve the caller's User from the Authorization: Bearer <token> header.

    Always 401 on failure (missing, expired, malformed, or forged token; a token
    for a user that no longer exists) — never 403. This dependency only answers
    "who are you"; whether that user is *allowed* to do something is a 403
    decision made by the endpoint/route dependency that needs `group_id` (§8.5),
    not here.
    """
    if credentials is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, _INVALID_TOKEN_MESSAGE)

    try:
        user_id = decode_access_token(credentials.credentials)
    except InvalidTokenError as exc:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, _INVALID_TOKEN_MESSAGE) from exc

    user = db.get(User, user_id)
    if user is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, _INVALID_TOKEN_MESSAGE)

    return user


CurrentUser = Annotated[User, Depends(get_current_user)]


def require_group_member(
    group_id: uuid.UUID,
    current_user: CurrentUser,
    db: DbSession,
) -> Group:
    """FastAPI dependency verifying `current_user` belongs to `group_id` (§8.5).

    `get_current_user` only answers "who are you"; this answers "are you in this
    group". Every group-scoped endpoint that takes `{id}` must depend on this
    (directly, or via a path that includes it), not just call `get_current_user`.

    Non-members get 403 — never 404. A group that doesn't exist and a group the
    caller isn't a member of are deliberately indistinguishable to the caller, so
    this doesn't leak which group ids exist. Never 401 either: 401 is reserved
    for "not authenticated at all", which `get_current_user` already handled by
    the time this dependency runs.
    """
    is_member = (
        db.query(GroupMember)
        .filter(GroupMember.group_id == group_id, GroupMember.user_id == current_user.id)
        .first()
        is not None
    )
    if not is_member:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Not a member of this group")

    group = db.get(Group, group_id)
    if group is None:
        # Unreachable given the group_members.group_id FK: a membership row can't
        # exist for a group that doesn't. Guarded rather than asserted so a bug
        # elsewhere surfaces as a clean 403, not a 500.
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Not a member of this group")

    return group


RequireGroupMember = Annotated[Group, Depends(require_group_member)]


def require_expense_membership(
    expense_id: uuid.UUID,
    current_user: CurrentUser,
    db: DbSession,
) -> Expense:
    """FastAPI dependency for the endpoints keyed by expense_id rather than
    group_id directly (GET/PATCH/DELETE /api/expenses/{id}, §7): resolves the
    expense, then applies the same group-membership check as
    require_group_member (§8.5) against the expense's own group_id.

    Unlike require_group_member, a missing expense IS a plain 404 here, not
    folded into 403 alongside "not a member": expense ids are opaque, unguessable
    UUIDs this API hands out, never something a client enumerates the way it
    might probe small/sequential group ids, so there's no existence signal worth
    hiding by making the two cases indistinguishable.
    """
    expense = db.get(Expense, expense_id)
    if expense is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Expense not found")

    is_member = (
        db.query(GroupMember)
        .filter(GroupMember.group_id == expense.group_id, GroupMember.user_id == current_user.id)
        .first()
        is not None
    )
    if not is_member:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Not a member of this group")

    return expense


RequireExpenseMembership = Annotated[Expense, Depends(require_expense_membership)]
