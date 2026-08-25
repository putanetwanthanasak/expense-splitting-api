"""Debt simplification — greedy matching (docs/SPEC.md §5).

Settling every pairwise debt directly produces more transfers than necessary
(A owes B, B owes C, C owes A nets out to zero transfers, not three). This
module reduces a group's net balances to a short list of transfers using the
greedy max-heap matching algorithm from §5: repeatedly match the biggest
creditor against the biggest debtor, transfer as much as satisfies the smaller
of the two, and push whichever side still has a nonzero balance back onto its
heap.

ABSOLUTE RULE, same as app/services/splitting.py: this module may not import
sqlalchemy, fastapi, or anything from app/models. It takes a plain
`dict[UUID, Decimal]` of net balances in and returns a plain list of
`Transfer` out — nothing else — so it stays testable as pure logic (including
the hypothesis property test in tests/test_debt_simplification.py) with no
database or web framework in the loop. See CLAUDE.md.

Every comparison here is against `Decimal("0")` directly, with no epsilon.
That only works because money is Decimal everywhere (§8.3) — with floats, a
residue like `0.0000000001` left over from repeated subtraction could keep a
party alive on its heap forever and the loop would never terminate.
"""

import heapq
import uuid
from dataclasses import dataclass
from decimal import Decimal

__all__ = ["Transfer", "simplify_debts"]

ZERO = Decimal("0")


@dataclass(frozen=True)
class Transfer:
    """One suggested repayment: `from_user_id` pays `amount` to `to_user_id`."""

    from_user_id: uuid.UUID
    to_user_id: uuid.UUID
    amount: Decimal


def simplify_debts(balances: dict[uuid.UUID, Decimal]) -> list[Transfer]:
    """This is a greedy heuristic that guarantees at most N-1 transfers.
    It does NOT compute the provable minimum — that problem is NP-hard
    (reducible to subset-sum/partition).

    `balances` maps user_id to net balance (§4): positive means a creditor
    (others owe them), negative means a debtor, zero means already settled.
    Members at exactly zero are excluded from both heaps and never appear in
    the output — there is nothing to transfer on their behalf.

    Termination: each iteration fully zeroes out at least one side (whichever
    amount is smaller) and removes it from its heap, so the loop runs at most
    N times for N members with a nonzero balance, producing at most N-1
    transfers overall.

    Correctness relies on the caller's balances already summing to zero
    (§4's core invariant, enforced elsewhere by §8.1) — creditors and debtors
    are then exhausted in the same iteration, so nobody is left stranded on
    either heap.

    Tie-breaking between equal-magnitude balances is by user_id, so the same
    input always produces the same transfer list (§8.8's determinism
    requirement applies here in spirit, even though §8.8 itself is written
    about remainder distribution).
    """
    # heapq is a min-heap; negate the magnitude to use it as a max-heap. For
    # debtors the balance is already negative, so the raw balance itself *is*
    # the negated debt magnitude -- no extra negation needed there. Push
    # user_id as the tiebreaker so equal amounts compare deterministically.
    creditors = [(-amount, user_id) for user_id, amount in balances.items() if amount > ZERO]
    debtors = [(amount, user_id) for user_id, amount in balances.items() if amount < ZERO]
    heapq.heapify(creditors)
    heapq.heapify(debtors)

    transfers: list[Transfer] = []

    while creditors and debtors:
        neg_credit, creditor_id = heapq.heappop(creditors)
        neg_debt, debtor_id = heapq.heappop(debtors)
        credit = -neg_credit
        debt = -neg_debt

        amount = min(credit, debt)
        transfers.append(Transfer(from_user_id=debtor_id, to_user_id=creditor_id, amount=amount))

        remaining_credit = credit - amount
        remaining_debt = debt - amount
        if remaining_credit > ZERO:
            heapq.heappush(creditors, (-remaining_credit, creditor_id))
        if remaining_debt > ZERO:
            heapq.heappush(debtors, (-remaining_debt, debtor_id))

    return transfers
