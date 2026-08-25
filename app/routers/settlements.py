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
)
def create(
    group_id: uuid.UUID,
    payload: SettlementCreate,
    group: RequireGroupMember,
    db: DbSession,
) -> SettlementRecordOut:
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


@router.get("/{group_id}/settlements", response_model=list[SettlementOut])
def list_settlements(
    group_id: uuid.UUID, group: RequireGroupMember, db: DbSession
) -> list[Settlement]:
    return list_group_settlements(db, group_id)
