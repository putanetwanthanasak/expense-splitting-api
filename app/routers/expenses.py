"""POST/GET /api/groups/{id}/expenses, GET/PATCH/DELETE /api/expenses/{id} (§7).

Two different path shapes share this router: expense creation and listing are
nested under their group (so `require_group_member` authorizes them directly
from the path's own group_id), while read/update/delete address one expense by
its own id (so `require_expense_membership` looks the expense up first and
authorizes from *its* group_id -- see app/dependencies.py).
"""

import uuid
from decimal import Decimal

from fastapi import APIRouter, HTTPException, Query, status

from app.dependencies import DbSession, RequireExpenseMembership, RequireGroupMember
from app.models.expense import Expense
from app.models.expense_split import ExpenseSplit
from app.schemas.expense import (
    EqualExpenseWrite,
    ExactExpenseWrite,
    ExpenseDetail,
    ExpenseListOut,
    ExpenseOut,
    ExpenseSplitOut,
    ExpenseWrite,
    PercentageExpenseWrite,
)
from app.services.expenses import (
    ExpenseNotFoundError,
    ExpenseValidationError,
    create_expense,
    delete_expense,
    list_group_expenses,
    update_expense,
)
from app.services.splitting import SplitValidationError

router = APIRouter(tags=["expenses"])

_SplitFields = tuple[
    list[uuid.UUID] | None,
    list[tuple[uuid.UUID, Decimal]] | None,
    list[tuple[uuid.UUID, Decimal]] | None,
    list[tuple[uuid.UUID, Decimal]] | None,
]


def _split_fields(payload: ExpenseWrite) -> _SplitFields:
    """(participant_user_ids, exact_amounts, percentages, shares) -- exactly
    one populated, matching payload.split_type -- ready to hand to
    app.services.expenses.create_expense/update_expense.
    """
    if isinstance(payload, EqualExpenseWrite):
        return payload.participant_user_ids, None, None, None
    if isinstance(payload, ExactExpenseWrite):
        return None, [(s.user_id, s.amount) for s in payload.splits], None, None
    if isinstance(payload, PercentageExpenseWrite):
        return None, None, [(s.user_id, s.percentage) for s in payload.splits], None
    return None, None, None, [(s.user_id, s.shares) for s in payload.splits]


def _load_splits(db: DbSession, expense_id: uuid.UUID) -> list[ExpenseSplitOut]:
    rows = (
        db.query(ExpenseSplit)
        .filter(ExpenseSplit.expense_id == expense_id)
        .order_by(ExpenseSplit.user_id)
        .all()
    )
    return [ExpenseSplitOut.model_validate(row) for row in rows]


def _to_detail(db: DbSession, expense: Expense) -> ExpenseDetail:
    return ExpenseDetail(
        id=expense.id,
        group_id=expense.group_id,
        paid_by_user_id=expense.paid_by_user_id,
        amount=expense.amount,
        description=expense.description,
        expense_date=expense.expense_date,
        split_type=expense.split_type,
        created_at=expense.created_at,
        splits=_load_splits(db, expense.id),
    )


@router.post(
    "/api/groups/{group_id}/expenses",
    response_model=ExpenseDetail,
    status_code=status.HTTP_201_CREATED,
)
def create(
    group_id: uuid.UUID,
    payload: ExpenseWrite,
    group: RequireGroupMember,
    db: DbSession,
) -> ExpenseDetail:
    participant_user_ids, exact_amounts, percentages, shares = _split_fields(payload)
    try:
        expense = create_expense(
            db,
            group_id=group_id,
            paid_by_user_id=payload.paid_by_user_id,
            amount=payload.amount,
            description=payload.description,
            expense_date=payload.expense_date,
            split_type=payload.split_type,
            participant_user_ids=participant_user_ids,
            exact_amounts=exact_amounts,
            percentages=percentages,
            shares=shares,
        )
    except (ExpenseValidationError, SplitValidationError) as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from exc

    return _to_detail(db, expense)


@router.get("/api/groups/{group_id}/expenses", response_model=ExpenseListOut)
def list_expenses(
    group_id: uuid.UUID,
    group: RequireGroupMember,
    db: DbSession,
    limit: int = Query(default=20, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
) -> ExpenseListOut:
    items, total = list_group_expenses(db, group_id, limit=limit, offset=offset)
    return ExpenseListOut(
        items=[ExpenseOut.model_validate(item) for item in items],
        total=total,
        limit=limit,
        offset=offset,
    )


@router.get("/api/expenses/{expense_id}", response_model=ExpenseDetail)
def get(expense_id: uuid.UUID, expense: RequireExpenseMembership, db: DbSession) -> ExpenseDetail:
    return _to_detail(db, expense)


@router.patch("/api/expenses/{expense_id}", response_model=ExpenseDetail)
def update(
    expense_id: uuid.UUID,
    payload: ExpenseWrite,
    expense: RequireExpenseMembership,
    db: DbSession,
) -> ExpenseDetail:
    participant_user_ids, exact_amounts, percentages, shares = _split_fields(payload)
    try:
        updated = update_expense(
            db,
            expense_id=expense_id,
            paid_by_user_id=payload.paid_by_user_id,
            amount=payload.amount,
            description=payload.description,
            expense_date=payload.expense_date,
            split_type=payload.split_type,
            participant_user_ids=participant_user_ids,
            exact_amounts=exact_amounts,
            percentages=percentages,
            shares=shares,
        )
    except ExpenseNotFoundError as exc:
        # Can't happen in practice -- RequireExpenseMembership already resolved
        # this expense_id above -- but guarded rather than assumed away.
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Expense not found") from exc
    except (ExpenseValidationError, SplitValidationError) as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from exc

    return _to_detail(db, updated)


@router.delete("/api/expenses/{expense_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete(expense_id: uuid.UUID, expense: RequireExpenseMembership, db: DbSession) -> None:
    delete_expense(db, expense_id)
