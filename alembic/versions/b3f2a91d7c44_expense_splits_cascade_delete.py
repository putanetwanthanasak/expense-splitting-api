"""expense_splits.expense_id cascades on delete

Revision ID: b3f2a91d7c44
Revises: 74795880b391
Create Date: 2026-08-24 09:00:00.000000

Deleting an expense must take its splits with it (docs/SPEC.md §9: "DELETE ->
splits cascade, and balances change immediately"). The initial schema created
this foreign key with no ON DELETE behavior, which defaults to RESTRICT in
Postgres and would make DELETE /api/expenses/{id} fail with a foreign key
violation whenever the expense still has splits -- i.e. always. This migration
fixes that at the database level rather than relying on application code to
delete children first (§10.9).
"""
from typing import Sequence, Union

from alembic import op

# revision identifiers, used by Alembic.
revision: str = 'b3f2a91d7c44'
down_revision: Union[str, Sequence[str], None] = '74795880b391'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.drop_constraint(
        'expense_splits_expense_id_fkey', 'expense_splits', type_='foreignkey'
    )
    op.create_foreign_key(
        'expense_splits_expense_id_fkey',
        'expense_splits',
        'expenses',
        ['expense_id'],
        ['id'],
        ondelete='CASCADE',
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_constraint(
        'expense_splits_expense_id_fkey', 'expense_splits', type_='foreignkey'
    )
    op.create_foreign_key(
        'expense_splits_expense_id_fkey',
        'expense_splits',
        'expenses',
        ['expense_id'],
        ['id'],
    )
