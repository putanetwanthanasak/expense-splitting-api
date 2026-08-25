"""POST /api/groups/{id}/settlements, GET /api/groups/{id}/settlements (§7, §9)."""

import uuid

from fastapi import APIRouter, HTTPException, status

from app.dependencies import DbSession, RequireGroupMember
from app.models.settlement import Settlement
from app.schemas.settlement import SettlementCreate, SettlementOut, SettlementRecordOut
from app.services.settlements import (
    SettlementValidationError,
    list_group_settlements,
    record_settlement,
)

router = APIRouter(prefix="/api/groups", tags=["settlements"])


@router.post(
    "/{group_id}/settlements",
    response_model=SettlementRecordOut,
    status_code=status.HTTP_201_CREATED,
    summary="Record a settlement",
)
def create(
    group_id: uuid.UUID,
    payload: SettlementCreate,
    group: RequireGroupMember,
    db: DbSession,
) -> SettlementRecordOut:
    """Record that from_user_id repaid to_user_id (§1: this is only a record --
    no real payment is processed). Both users must be group members and must
    differ (§8.7), and amount must be positive. Paying more than currently
    owed is allowed and returns a `warning` -- the payer becomes a net
    creditor as a result.
    """
    try:
        settlement, warning = record_settlement(
            db,
            group_id=group_id,
            from_user_id=payload.from_user_id,
            to_user_id=payload.to_user_id,
            amount=payload.amount,
        )
    except SettlementValidationError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from exc

    return SettlementRecordOut(
        id=settlement.id,
        group_id=settlement.group_id,
        from_user_id=settlement.from_user_id,
        to_user_id=settlement.to_user_id,
        amount=settlement.amount,
        settled_at=settlement.settled_at,
        warning=warning,
    )


@router.get(
    "/{group_id}/settlements",
    response_model=list[SettlementOut],
    summary="List settlement history",
)
def list_settlements(
    group_id: uuid.UUID, group: RequireGroupMember, db: DbSession
) -> list[Settlement]:
    """This group's recorded settlements, newest first."""
    return list_group_settlements(db, group_id)
