"""Request/response schemas for settlement endpoints (§7, §9).

Money follows the same Annotated[Decimal, Field(...)] spelling as
app/schemas/expense.py's `Money` -- see that module's comment for why a bare
condecimal(...) call isn't used.
"""

import uuid
from datetime import datetime
from decimal import Decimal
from typing import Annotated

from fastapi import HTTPException, status
from pydantic import BaseModel, ConfigDict, Field, model_validator

Money = Annotated[Decimal, Field(max_digits=12, decimal_places=2)]


class SettlementCreate(BaseModel):
    from_user_id: uuid.UUID
    to_user_id: uuid.UUID
    # Deliberately NOT constrained to be > 0 here, same reasoning as
    # app/schemas/expense.py's `amount`: a Pydantic constraint violation is a
    # 422, but §9 requires 400 for a non-positive settlement amount, so that
    # check lives in app/services/settlements.py instead, where the response
    # code can be chosen explicitly.
    amount: Money

    @model_validator(mode="after")
    def _check_payer_and_recipient_differ(self) -> "SettlementCreate":
        """§8.7: a settlement's payer and recipient must differ. This is the
        Pydantic half of that rule -- the database CHECK constraint
        (ck_settlements_from_ne_to) is the other half; CLAUDE.md is explicit
        that neither may stand alone.

        Raising HTTPException here instead of the usual ValueError is
        deliberate: a plain ValueError would get folded into Pydantic's
        ValidationError and surface as a 422, but §9 requires this specific
        violation to be a 400 like every other settlement validation failure.
        Pydantic only intercepts ValueError/TypeError/AssertionError from a
        validator -- any other exception, HTTPException included, propagates
        through FastAPI unchanged and is handled by the same
        @app.exception_handler(HTTPException) as every other 400 in this API.
        """
        if self.from_user_id == self.to_user_id:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST, "from_user_id and to_user_id must differ"
            )
        return self


class SettlementOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    group_id: uuid.UUID
    from_user_id: uuid.UUID
    to_user_id: uuid.UUID
    amount: Decimal
    settled_at: datetime


class SettlementRecordOut(SettlementOut):
    """POST /api/groups/{id}/settlements: the created settlement plus an
    optional warning (§9) -- set when from_user_id paid more than they
    currently owed and became a net creditor as a result. Never present on
    historical settlements returned by GET, only on the response to the
    request that created one.
    """

    warning: str | None = None
