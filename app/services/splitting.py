"""Split-calculation logic — the largest remainder method (docs/SPEC.md §6).

§6 calls this "the hardest part" of the project, and the reason is arithmetic, not
code: splitting 100 three ways gives 33.333... each, and 33.33 x 3 = 99.99, not
100.00. Left unhandled, that missing cent makes group balances stop summing to
zero (§8.1) and the error compounds silently across every future expense.

The fix is the largest remainder method:
  1. Round every participant's ideal share DOWN to the cent (never
     ROUND_HALF_UP — half-up can round a share *above* its ideal value, and then
     several shares rounding up at once can overshoot the total, which is a
     harder error to recover from than a shortfall is).
  2. Sum the rounded shares. Because both the total and every rounded share carry
     at most two decimal places, `total - sum(rounded shares)` is always an exact,
     non-negative, whole number of cents — never a rounding artifact itself.
  3. Hand that remainder out one cent at a time, in the order participants were
     given (§8.8: "always a fixed, reproducible order. No sets, no unordered dict
     iteration."). The first `k` participants in that order each receive one
     extra cent, where `k` is the number of leftover cents. Recomputing the same
     split with the same input order always produces the same answer.

ABSOLUTE RULE: this module may not import sqlalchemy, fastapi, or anything from
app/models. It takes plain Decimals and UUIDs in and returns plain dicts out —
nothing else — so it stays testable as pure logic (including the hypothesis
property test in tests/test_split_calculation.py) with no database or web
framework in the loop, and reusable from a script, a different endpoint, or a
future async path without dragging a sync Session along. See CLAUDE.md.

Every function here raises SplitValidationError, never HTTPException — this layer
knows nothing about HTTP. The router/service layer (Phase 6) is what translates a
SplitValidationError into a 400.
"""

import uuid
from collections.abc import Mapping, Sequence
from decimal import ROUND_DOWN, Decimal

CENT = Decimal("0.01")
HUNDRED = Decimal("100")


class SplitValidationError(Exception):
    """Raised when a split's inputs are invalid: an EXACT total that doesn't
    match, a PERCENTAGE that doesn't sum to 100, a non-positive SHARES count, or
    an empty participant list. Never raised for a rounding failure — the largest
    remainder method guarantees an exact split whenever the inputs are valid, and
    that guarantee is asserted, not merely hoped for (see
    `_distribute_largest_remainder` below).
    """


def _distribute_largest_remainder(
    total: Decimal,
    ideal_shares: Mapping[uuid.UUID, Decimal],
    order: Sequence[uuid.UUID],
) -> dict[uuid.UUID, Decimal]:
    """Round every ideal share down to the cent, then hand out the leftover
    cents one at a time to make the rounded shares sum back to `total` exactly.

    Which participants get the extra cents: the first `len(remainder in cents)`
    participants in `order` — i.e. `order[0]`, `order[1]`, ... — get exactly one
    extra cent each, and no one gets more than one. `order` is caller-supplied
    (the input list/dict's own iteration order, per §8.8), so the same input
    always produces the same winners; nothing here consults a set, a hash, or any
    other unordered structure, and nothing is randomized.

    Why this is always safe: rounding a share down to the cent can only ever
    understate it, by strictly less than one cent. Summed over `len(order)`
    participants, the total understatement is therefore strictly less than
    `len(order)` cents — so the number of leftover cents to distribute is always
    fewer than the number of participants, and every leftover cent has a distinct
    participant in `order` to land on.
    """
    shares = {uid: ideal_shares[uid].quantize(CENT, rounding=ROUND_DOWN) for uid in order}

    remainder = total - sum(shares.values(), start=Decimal("0.00"))
    extra_cents = int(remainder / CENT)

    for i in range(extra_cents):
        shares[order[i]] += CENT

    # §8.2 / §6 rule 1: shares must always sum to the total exactly. Assert it in
    # application code, not only in tests — a violation here means the largest
    # remainder reasoning above has a bug, and that must fail loudly, not
    # silently corrupt a balance.
    assert sum(shares.values(), start=Decimal("0.00")) == total, (
        "largest remainder distribution did not sum to the total — this is a bug "
        "in splitting.py, not a caller error"
    )
    return shares


def split_equally(total: Decimal, user_ids: list[uuid.UUID]) -> dict[uuid.UUID, Decimal]:
    """Split `total` evenly across `user_ids`. At least one participant required.

    Extra cents go to `user_ids[0]`, `user_ids[1]`, ... in list order — see
    `_distribute_largest_remainder` for why that's always enough participants and
    always deterministic.
    """
    if not user_ids:
        raise SplitValidationError("EQUAL split requires at least one participant")
    if len(set(user_ids)) != len(user_ids):
        # Not a rounding concern, but letting it through would silently split
        # the total across fewer distinct people than the caller listed —
        # exactly the kind of silent-corruption bug §6 exists to prevent.
        raise SplitValidationError("EQUAL split participants must be unique")

    ideal_share = total / len(user_ids)
    ideal_shares = {uid: ideal_share for uid in user_ids}
    return _distribute_largest_remainder(total, ideal_shares, order=user_ids)


def split_exact(total: Decimal, amounts: Mapping[uuid.UUID, Decimal]) -> dict[uuid.UUID, Decimal]:
    """EXACT split: each participant's amount is given directly, not derived.

    The only rule (§6: "EXACT is the only type that needs no rounding") is that
    the amounts must sum to `total` exactly; a mismatch is rejected outright,
    never silently adjusted. No remainder distribution happens here — there is no
    rounding to correct, so there are no "extra cents" or ordering concerns for
    this split type.
    """
    if not amounts:
        raise SplitValidationError("EXACT split requires at least one participant")

    provided_total = sum(amounts.values(), start=Decimal("0.00"))
    if provided_total != total:
        raise SplitValidationError(
            f"EXACT amounts sum to {provided_total}, which does not match the "
            f"expense total {total}"
        )

    shares = dict(amounts)
    assert sum(shares.values(), start=Decimal("0.00")) == total
    return shares


def split_by_percentage(
    total: Decimal, percentages: Mapping[uuid.UUID, Decimal]
) -> dict[uuid.UUID, Decimal]:
    """Split `total` proportionally to each participant's percentage.

    Percentages must sum to exactly 100 — rejected otherwise, never normalized on
    the caller's behalf. Each participant's ideal share is `total * pct / 100`;
    that's rounded down and the leftover cents are handed out to the first
    participants in `percentages`' own iteration order (i.e. the order the caller
    built the mapping in — see `_distribute_largest_remainder`).
    """
    if not percentages:
        raise SplitValidationError("PERCENTAGE split requires at least one participant")

    provided_total = sum(percentages.values(), start=Decimal("0"))
    if provided_total != HUNDRED:
        raise SplitValidationError(
            f"percentages sum to {provided_total}, which does not equal 100"
        )

    order = list(percentages.keys())
    ideal_shares = {uid: total * pct / HUNDRED for uid, pct in percentages.items()}
    return _distribute_largest_remainder(total, ideal_shares, order)


def split_by_shares(
    total: Decimal, shares: Mapping[uuid.UUID, Decimal]
) -> dict[uuid.UUID, Decimal]:
    """Split `total` proportionally to each participant's share count (e.g. 2:1:1).

    Every share must be strictly positive — zero or negative is rejected, never
    silently dropped or treated as "opts out". Each participant's ideal portion
    is `total * their_share / total_shares`; that's rounded down and the leftover
    cents are handed out to the first participants in `shares`' own iteration
    order (see `_distribute_largest_remainder`).
    """
    if not shares:
        raise SplitValidationError("SHARES split requires at least one participant")

    for uid, count in shares.items():
        if count <= 0:
            raise SplitValidationError(f"share for {uid} must be > 0, got {count}")

    total_shares = sum(shares.values(), start=Decimal("0"))
    order = list(shares.keys())
    ideal_shares = {uid: total * count / total_shares for uid, count in shares.items()}
    return _distribute_largest_remainder(total, ideal_shares, order)
