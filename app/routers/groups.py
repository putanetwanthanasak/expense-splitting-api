"""POST /api/groups, GET /api/groups, GET /api/groups/{id},
POST /api/groups/{id}/members, DELETE /api/groups/{id}/members/{uid} (§7).
"""

import uuid

from fastapi import APIRouter, HTTPException, status

from app.dependencies import CurrentUser, DbSession, RequireGroupMember
from app.models.group import Group
from app.models.group_member import GroupMember
from app.models.user import User
from app.schemas.group import AddMemberRequest, GroupCreate, GroupDetail, GroupMemberOut, GroupOut
from app.services.groups import (
    AlreadyMemberError,
    MemberNotFoundError,
    UserNotFoundError,
    add_member,
    create_group,
    remove_member,
)

router = APIRouter(prefix="/api/groups", tags=["groups"])


@router.post("", response_model=GroupOut, status_code=status.HTTP_201_CREATED)
def create(payload: GroupCreate, current_user: CurrentUser, db: DbSession) -> Group:
    return create_group(db, name=payload.name, creator_id=current_user.id)


@router.get("", response_model=list[GroupOut])
def list_my_groups(current_user: CurrentUser, db: DbSession) -> list[Group]:
    """Only groups the caller belongs to — never other people's (§7)."""
    return (
        db.query(Group)
        .join(GroupMember, GroupMember.group_id == Group.id)
        .filter(GroupMember.user_id == current_user.id)
        .order_by(Group.created_at, Group.id)
        .all()
    )


@router.get("/{group_id}", response_model=GroupDetail)
def get_group(group_id: uuid.UUID, group: RequireGroupMember, db: DbSession) -> GroupDetail:
    rows = (
        db.query(GroupMember, User)
        .join(User, User.id == GroupMember.user_id)
        .filter(GroupMember.group_id == group_id)
        .order_by(GroupMember.joined_at, GroupMember.id)  # deterministic, not DB-default order
        .all()
    )
    members = [
        GroupMemberOut(user_id=user.id, email=user.email, name=user.name, joined_at=gm.joined_at)
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
    "/{group_id}/members", response_model=GroupMemberOut, status_code=status.HTTP_201_CREATED
)
def add_group_member(
    group_id: uuid.UUID,
    payload: AddMemberRequest,
    group: RequireGroupMember,
    db: DbSession,
) -> GroupMemberOut:
    try:
        member = add_member(db, group_id=group_id, user_id=payload.user_id)
    except UserNotFoundError as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "User not found") from exc
    except AlreadyMemberError as exc:
        raise HTTPException(
            status.HTTP_409_CONFLICT, "User is already a member of this group"
        ) from exc

    user = db.get(User, payload.user_id)
    assert user is not None  # add_member already confirmed this user exists
    return GroupMemberOut(
        user_id=user.id, email=user.email, name=user.name, joined_at=member.joined_at
    )


@router.delete("/{group_id}/members/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_group_member(
    group_id: uuid.UUID,
    user_id: uuid.UUID,
    group: RequireGroupMember,
    db: DbSession,
) -> None:
    try:
        remove_member(db, group_id=group_id, user_id=user_id)
    except MemberNotFoundError as exc:
        raise HTTPException(
            status.HTTP_404_NOT_FOUND, "User is not a member of this group"
        ) from exc
