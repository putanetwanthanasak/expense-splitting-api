"""GET /api/me/invitations — the caller's own pending group invitations (§7.1)."""

from fastapi import APIRouter

from app.dependencies import CurrentUser, DbSession
from app.schemas.group import InvitationOut
from app.services.groups import list_pending_invitations

router = APIRouter(prefix="/api/me", tags=["invitations"])


@router.get(
    "/invitations",
    response_model=list[InvitationOut],
    summary="List my pending group invitations",
)
def list_my_invitations(current_user: CurrentUser, db: DbSession) -> list[InvitationOut]:
    """Every PENDING membership the caller holds, across all groups (§7.1).
    Accept one with POST /api/groups/{id}/members/me/accept, or decline it with
    .../members/me/decline. Groups the caller has already joined are in
    GET /api/groups instead.
    """
    return [
        InvitationOut(group_id=group.id, group_name=group.name, invited_at=member.joined_at)
        for member, group in list_pending_invitations(db, user_id=current_user.id)
    ]
