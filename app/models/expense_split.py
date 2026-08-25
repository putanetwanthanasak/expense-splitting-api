"""expense_splits table — each participant's share of an expense.

Invariant (§8.2): SUM(amount_owed) over an expense's splits must equal expense.amount
exactly. This is asserted in application code before commit, not just here.
"""

import uuid
from decimal import Decimal

from sqlalchemy import ForeignKey, Numeric, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class ExpenseSplit(Base):
    __tablename__ = "expense_splits"
    __table_args__ = (
        UniqueConstraint("expense_id", "user_id", name="uq_expense_splits_expense_id_user_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    # ondelete="CASCADE": deleting an expense must take its splits with it (§9
    # "DELETE -> splits cascade, and balances change immediately") — enforced at
    # the database level, not by the application remembering to delete children
    # first (§10.9: a check, or a manual delete-then-delete, is not a lock).
    expense_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("expenses.id", ondelete="CASCADE"), nullable=False
    )
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), nullable=False)
    # Money is ALWAYS Numeric(12, 2), never Float. See docs/SPEC.md §8.3.
    amount_owed: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)
