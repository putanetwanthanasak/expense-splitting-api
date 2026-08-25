"""Request/response schemas for balance and settle-up endpoints (§7)."""

import uuid
from decimal import Decimal

from pydantic import BaseModel

# §5: never say "minimum" or "optimal" about debt simplification anywhere
# user-facing. This exact note is what the API hands back on every /settle-up
# response so a client surfaces it verbatim instead of writing its own
# (potentially over-claiming) copy.
SETTLE_UP_NOTE = (
    "Simplified using greedy matching; guarantees at most N-1 transfers, not a "
    "proven minimum."
)


class BalanceOut(BaseModel):
    """One member's net balance within a group (§4).

    Positive = creditor (others owe this member), negative = debtor, zero =
    settled.
    """

    user_id: uuid.UUID
    net_balance: Decimal


class GroupBalancesOut(BaseModel):
    """GET /api/groups/{id}/balances: net balance for every current member."""

    balances: list[BalanceOut]


class TransferOut(BaseModel):
    from_user_id: uuid.UUID
    to_user_id: uuid.UUID
    amount: Decimal


class SettleUpOut(BaseModel):
    """GET /api/groups/{id}/settle-up: the simplified transfer list (§5, §7)."""

    transfers: list[TransferOut]
    note: str = SETTLE_UP_NOTE
