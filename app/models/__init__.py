"""ORM models.

Six tables: users, groups, group_members, expenses, expense_splits, settlements.

There is deliberately NO `balances` table (see docs/SPEC.md §3). Balances are
recomputed live from expenses + settlements on every read. A stored balance column
would reproduce the classic lost-update race: two concurrent expense inserts both
read the old balance and write back conflicting totals, and nobody ever finds out.
Live computation has no state to corrupt — it's slower at scale, and that trade is
correct here. Do not "optimize" this into a balances table; if caching ever becomes
necessary, it needs a materialized view or a guarded write with a version column,
never a naive `UPDATE ... SET amount = amount + ?`.

Every model is imported here so Alembic's autogenerate sees the full metadata.
"""

from app.models.enums import MembershipStatus, SplitType
from app.models.expense import Expense
from app.models.expense_split import ExpenseSplit
from app.models.group import Group
from app.models.group_member import GroupMember
from app.models.settlement import Settlement
from app.models.user import User

__all__ = [
    "Expense",
    "ExpenseSplit",
    "Group",
    "GroupMember",
    "MembershipStatus",
    "Settlement",
    "SplitType",
    "User",
]
