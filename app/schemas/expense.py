"""Request/response schemas for expense endpoints (§7).

The request body is a discriminated union on `split_type`: each split type
exposes only the field it actually needs (a plain participant list for EQUAL,
an amount/percentage/share per participant for the other three), so a client
literally cannot send, say, EXACT amounts under split_type EQUAL -- Pydantic
rejects the shape mismatch before the handler ever runs (§10.5: validate at the
boundary). PATCH reuses the exact same shape as POST: §9 requires a PATCH to
delete every existing split and recompute all of them from scratch, which means
a PATCH request must describe a complete expense, not a partial one.
"""

import uuid
from datetime import date, datetime
from decimal import Decimal
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field

from app.models.enums import SplitType

# §8.3 / CLAUDE.md specify condecimal(max_digits=12, decimal_places=2) for every
# money field. Written here as Annotated[Decimal, Field(...)] instead, which
# validates identically -- Pydantic v2's condecimal() is a thin wrapper that
# returns exactly this at runtime -- because a bare `condecimal(...)` call
# cannot be used as a type mypy can check (confirmed under --strict, even with
# the pydantic mypy plugin enabled: "Cannot use a function call in a type
# annotation"). This is the spelling Pydantic v2 itself now recommends.
Money = Annotated[Decimal, Field(max_digits=12, decimal_places=2)]

# A percentage point, e.g. "33.33" -- at most "100.00", hence 5 significant digits.
Percentage = Annotated[Decimal, Field(max_digits=5, decimal_places=2)]

# A share weight, e.g. "2" in a 2:1:1 split. Decimal, not int, so a group can use
# fractional shares if it wants to; whether it's positive is validated by
# splitting.py, not here (see the module docstring on why: this schema only
# describes shape, never split arithmetic or its rules).
ShareCount = Annotated[Decimal, Field(max_digits=12, decimal_places=2)]


class ExactSplitEntry(BaseModel):
    user_id: uuid.UUID
    amount: Money


class PercentageSplitEntry(BaseModel):
    user_id: uuid.UUID
    percentage: Percentage


class SharesSplitEntry(BaseModel):
    user_id: uuid.UUID
    shares: ShareCount


class _ExpenseWriteBase(BaseModel):
    # Deliberately NOT constrained to be > 0 here even though a non-positive
    # amount is always invalid (§9): a Pydantic constraint violation is a 422,
    # but §9 requires 400 for this specific case, so it's checked in
    # app/services/expenses.py instead, where the response code can be chosen
    # explicitly. Same reasoning applies to duplicate participants and EXACT
    # sum mismatches -- none of those are Pydantic-level constraints either.
    amount: Money
    description: str = Field(min_length=1)
    expense_date: date  # when the expense happened, distinct from created_at
    paid_by_user_id: uuid.UUID


class EqualExpenseWrite(_ExpenseWriteBase):
    split_type: Literal[SplitType.EQUAL] = SplitType.EQUAL
    participant_user_ids: list[uuid.UUID] = Field(min_length=1)


class ExactExpenseWrite(_ExpenseWriteBase):
    split_type: Literal[SplitType.EXACT] = SplitType.EXACT
    splits: list[ExactSplitEntry] = Field(min_length=1)


class PercentageExpenseWrite(_ExpenseWriteBase):
    split_type: Literal[SplitType.PERCENTAGE] = SplitType.PERCENTAGE
    splits: list[PercentageSplitEntry] = Field(min_length=1)


class SharesExpenseWrite(_ExpenseWriteBase):
    split_type: Literal[SplitType.SHARES] = SplitType.SHARES
    splits: list[SharesSplitEntry] = Field(min_length=1)


ExpenseWrite = Annotated[
    EqualExpenseWrite | ExactExpenseWrite | PercentageExpenseWrite | SharesExpenseWrite,
    Field(discriminator="split_type"),
]


class ExpenseSplitOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    user_id: uuid.UUID
    amount_owed: Decimal


class ExpenseOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    group_id: uuid.UUID
    paid_by_user_id: uuid.UUID
    amount: Decimal
    description: str
    expense_date: date
    split_type: SplitType
    created_at: datetime


class ExpenseDetail(ExpenseOut):
    """GET /api/expenses/{id}: expense details + its splits."""

    splits: list[ExpenseSplitOut]


class ExpenseListOut(BaseModel):
    """GET /api/groups/{id}/expenses: one page of a group's expenses."""

    items: list[ExpenseOut]
    total: int
    limit: int
    offset: int
