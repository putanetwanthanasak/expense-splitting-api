"""POST /api/groups, GET /api/groups, GET /api/groups/{id},
POST /api/groups/{id}/members, DELETE /api/groups/{id}/members/{uid},
GET /api/groups/{id}/balances, GET /api/groups/{id}/settle-up (§7).
"""

import uuid

from fastapi import APIRouter, HTTPException, status

from app.dependencies import CurrentUser, DbSession, RequireGroupMember
from app.models.enums import MembershipStatus
from app.models.group import Group
from app.models.group_member import GroupMember
from app.models.user import User
from app.schemas.balance import BalanceOut, GroupBalancesOut, SettleUpOut, TransferOut
from app.schemas.group import AddMemberRequest, GroupCreate, GroupDetail, GroupMemberOut, GroupOut
from app.services.balances import compute_group_net_balances
from app.services.groups import (
    AlreadyMemberError,
    MemberHasOutstandingBalanceError,
    MemberNotFoundError,
    NoPendingInvitationError,
    UserNotFoundError,
    accept_invitation,
    add_member,
    create_group,
    decline_invitation,
    remove_member,
)
from app.services.simplify import simplify_debts

router = APIRouter(prefix="/api/groups", tags=["groups"])


@router.post(
    "", response_model=GroupOut, status_code=status.HTTP_201_CREATED, summary="Create a group"
)
def create(payload: GroupCreate, current_user: CurrentUser, db: DbSession) -> Group:
    """Create a group. The creator becomes a member immediately -- a group with
    zero members is never observable, even transiently (§7).
    """
    return create_group(db, name=payload.name, creator_id=current_user.id)


@router.get("", response_model=list[GroupOut], summary="List my groups")
def list_my_groups(current_user: CurrentUser, db: DbSession) -> list[Group]:
    """Only groups the caller is an ACTIVE member of — never other people's, and
    never groups where the caller only has a PENDING invitation (§7.1: those
    belong in GET /api/me/invitations instead).
    """
    return (
        db.query(Group)
        .join(GroupMember, GroupMember.group_id == Group.id)
        .filter(
            GroupMember.user_id == current_user.id,
            GroupMember.status == MembershipStatus.ACTIVE,
        )
        .order_by(Group.created_at, Group.id)
        .all()
    )


@router.get("/{group_id}", response_model=GroupDetail, summary="Get group details")
def get_group(group_id: uuid.UUID, group: RequireGroupMember, db: DbSession) -> GroupDetail:
    """Group details plus its current member list. Non-members get 403, not
    404 (§8.5) -- a group that doesn't exist and one the caller isn't in are
    deliberately indistinguishable.
    """
    rows = (
        db.query(GroupMember, User)
        .join(User, User.id == GroupMember.user_id)
        .filter(
            GroupMember.group_id == group_id,
            # Both PENDING and ACTIVE rows (§7.1): the caller here is already
            # known to be an ACTIVE member (require_group_member gates this
            # endpoint), so showing who's been invited but hasn't accepted
            # yet is safe -- each row carries its own `status` so the caller
            # can tell them apart. This does NOT change who can call this
            # endpoint, and every other group-scoped query (/balances,
            # /settle-up, GET /api/groups, expense participants) stays
            # ACTIVE-only exactly as before.
        )
        .order_by(GroupMember.joined_at, GroupMember.id)  # deterministic, not DB-default order
        .all()
    )
    members = [
        GroupMemberOut(
            user_id=user.id, email=user.email, name=user.name, joined_at=gm.joined_at,
            status=gm.status,
        )
        for gm, user in rows
    ]
    return GroupDetail(
        id=group.id,
        name=group.name,
        created_by_user_id=group.created_by_user_id,
        created_at=group.created_at,
        members=members,
    )


@router.post(
    "/{group_id}/members",
    response_model=GroupMemberOut,
    status_code=status.HTTP_201_CREATED,
    summary="Add a group member",
)
def add_group_member(
    group_id: uuid.UUID,
    payload: AddMemberRequest,
    group: RequireGroupMember,
    db: DbSession,
) -> GroupMemberOut:
    """Add an existing user to the group. The caller must already be a member
    (§8.5); adding a user who is already a member is a 409, and a user_id that
    doesn't exist is a 400 (it's a body reference, not the URL's resource).
    """
    try:
        member = add_member(db, group_id=group_id, user_id=payload.user_id)
    except UserNotFoundError as exc:
        # 400, not 404: user_id is a reference inside the request body, not the
        # resource named by the URL path. Same pattern as §8.6 (a non-member
        # participant on an expense is a 400) and the settlement edge case
        # "paying someone outside the group -> 400" (§9) — 404 is reserved for
        # a missing path resource, e.g. the group itself.
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "No such user") from exc
    except AlreadyMemberError as exc:
        raise HTTPException(
            status.HTTP_409_CONFLICT, "User is already a member of this group"
        ) from exc

    user = db.get(User, payload.user_id)
    assert user is not None  # add_member already confirmed this user exists
    return GroupMemberOut(
        user_id=user.id,
        email=user.email,
        name=user.name,
        joined_at=member.joined_at,
        status=member.status,
    )


@router.post(
    "/{group_id}/members/me/accept",
    response_model=GroupMemberOut,
    summary="Accept a group invitation",
)
def accept_group_invitation(
    group_id: uuid.UUID, current_user: CurrentUser, db: DbSession
) -> GroupMemberOut:
    """Flip the caller's own PENDING membership in this group to ACTIVE (§7.1).

    Deliberately does NOT depend on `require_group_member` — that would 403 a
    PENDING invitee before this handler ever ran. 404 if the caller has no
    PENDING row here (never invited, already ACTIVE, or already
    declined/removed).
    """
    try:
        member, user = accept_invitation(db, group_id=group_id, user_id=current_user.id)
    except NoPendingInvitationError as exc:
        raise HTTPException(
            status.HTTP_404_NOT_FOUND, "No pending invitation for you in this group"
        ) from exc

    return GroupMemberOut(
        user_id=user.id,
        email=user.email,
        name=user.name,
        joined_at=member.joined_at,
        status=member.status,
    )


@router.post(
    "/{group_id}/members/me/decline",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Decline a group invitation",
)
def decline_group_invitation(
    group_id: uuid.UUID, current_user: CurrentUser, db: DbSession
) -> None:
    """Delete the caller's own PENDING membership in this group (§7.1). Same
    404 rule as accept, and likewise not gated by `require_group_member`.
    """
    try:
        decline_invitation(db, group_id=group_id, user_id=current_user.id)
    except NoPendingInvitationError as exc:
        raise HTTPException(
            status.HTTP_404_NOT_FOUND, "No pending invitation for you in this group"
        ) from exc


@router.get(
    "/{group_id}/balances", response_model=GroupBalancesOut, summary="Get group balances"
)
def get_group_balances(
    group_id: uuid.UUID, group: RequireGroupMember, db: DbSession
) -> GroupBalancesOut:
    """Net balance for every current member (§4), computed live -- never cached
    (§8.4). Sorted by user_id for a deterministic response order (§8.8's
    reproducibility spirit applies here too), not whatever order the query
    happens to return.
    """
    balances = compute_group_net_balances(db, group_id)
    ordered = [
        BalanceOut(user_id=user_id, net_balance=net)
        for user_id, net in sorted(balances.items(), key=lambda item: item[0])
    ]
    return GroupBalancesOut(balances=ordered)


@router.get(
    "/{group_id}/settle-up",
    response_model=SettleUpOut,
    summary="Get simplified settle-up transfers",
)
def get_group_settle_up(
    group_id: uuid.UUID, group: RequireGroupMember, db: DbSession
) -> SettleUpOut:
    """Simplified transfer list (§5) that would bring every member's balance to
    zero. The `note` field is required reading, not decoration: the algorithm is
    a greedy heuristic, not a proven minimum (§5, CLAUDE.md).
    """
    balances = compute_group_net_balances(db, group_id)
    transfers = simplify_debts(balances)
    return SettleUpOut(
        transfers=[
            TransferOut(from_user_id=t.from_user_id, to_user_id=t.to_user_id, amount=t.amount)
            for t in transfers
        ]
    )


@router.delete(
    "/{group_id}/members/{user_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Remove a group member",
)
def remove_group_member(
    group_id: uuid.UUID,
    user_id: uuid.UUID,
    group: RequireGroupMember,
    db: DbSession,
) -> None:
    """Remove a member from the group. 409 if their net balance isn't zero
    (§8.1, §9) -- removing them would break the group's sum-to-zero invariant;
    the response states the outstanding amount. A net-zero member can always
    be removed, and their expense history is kept intact.
    """
    try:
        remove_member(db, group_id=group_id, user_id=user_id)
    except MemberNotFoundError as exc:
        raise HTTPException(
            status.HTTP_404_NOT_FOUND, "User is not a member of this group"
        ) from exc
    except MemberHasOutstandingBalanceError as exc:
        # 409, not 400: the request is well-formed, it's the group's current
        # state that forbids it (§8.1 -- removing them would break the
        # sum-to-zero invariant). The outstanding amount goes in the body so
        # the caller knows what has to be settled first.
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            {
                "message": "Cannot remove a member with a non-zero balance",
                "outstanding_balance": str(exc.net_balance),
            },
        ) from exc
