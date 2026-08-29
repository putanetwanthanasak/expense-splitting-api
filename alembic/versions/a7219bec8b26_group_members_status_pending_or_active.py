"""group_members.status PENDING or ACTIVE

Revision ID: a7219bec8b26
Revises: b3f2a91d7c44
Create Date: 2026-08-29 23:04:34.347136

Adds group membership acceptance (docs/SPEC.md §7.1). A `group_members` row now
carries a `status`: PENDING (an unaccepted invite, grants nothing) or ACTIVE (a
real membership). POST /groups/{id}/members creates PENDING rows; the invitee
flips their own row to ACTIVE via POST .../members/me/accept.

Backfill: every row that existed before this feature was implicitly a real,
accepted membership, so it is backfilled to ACTIVE. The column is added with a
temporary server_default of 'ACTIVE' purely to fill those existing rows in the
same statement, then the server default is dropped: from here on every INSERT
must state the status explicitly (the app always does), so a forgotten status is
a database error rather than a silent auto-accept.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = 'a7219bec8b26'
down_revision: Union[str, Sequence[str], None] = 'b3f2a91d7c44'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

membership_status = sa.Enum('PENDING', 'ACTIVE', name='membership_status')


def upgrade() -> None:
    """Upgrade schema."""
    bind = op.get_bind()
    membership_status.create(bind, checkfirst=True)
    op.add_column(
        'group_members',
        sa.Column(
            'status',
            membership_status,
            nullable=False,
            server_default='ACTIVE',  # backfills pre-existing rows in this statement
        ),
    )
    # New rows must supply status explicitly from here on (see module docstring).
    op.alter_column('group_members', 'status', server_default=None)


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column('group_members', 'status')
    membership_status.drop(op.get_bind(), checkfirst=True)
