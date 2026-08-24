"""Request/response schemas for group and group-membership endpoints (§7)."""

import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class GroupCreate(BaseModel):
    name: str = Field(min_length=1)


class GroupOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    created_by_user_id: uuid.UUID
    created_at: datetime


class GroupMemberOut(BaseModel):
    """A group member as returned to clients — the user's public fields plus
    when they joined this particular group.
    """

    user_id: uuid.UUID
    email: str
    name: str
    joined_at: datetime


class GroupDetail(GroupOut):
    """GET /api/groups/{id}: group details + member list."""

    members: list[GroupMemberOut]


class AddMemberRequest(BaseModel):
    user_id: uuid.UUID
