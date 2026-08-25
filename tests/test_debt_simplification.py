"""Debt-simplification unit tests (docs/SPEC.md §5, §12). Pure logic, no
database required -- everything here exercises app/services/simplify.py directly.
"""

import uuid
from decimal import Decimal

from hypothesis import given, settings
from hypothesis import strategies as st

from app.services.simplify import Transfer, simplify_debts


def _ids(n: int) -> list[uuid.UUID]:
    return [uuid.uuid4() for _ in range(n)]


def _apply(
    balances: dict[uuid.UUID, Decimal], transfers: list[Transfer]
) -> dict[uuid.UUID, Decimal]:
    """Apply every transfer to a copy of `balances` the same way a settlement
    would (§4): paying reduces the payer's net, receiving raises the
    recipient's. Used to check that the transfer list actually zeroes
    everyone out, not just that it looks plausible.
    """
    result = dict(balances)
    for t in transfers:
        result[t.from_user_id] += t.amount
        result[t.to_user_id] -= t.amount
    return result


# --- direct cases --------------------------------------------------------


def test_everyone_at_net_zero_returns_no_transfers() -> None:
    alice, bob, carol = _ids(3)
    balances = {alice: Decimal("0.00"), bob: Decimal("0.00"), carol: Decimal("0.00")}

    assert simplify_debts(balances) == []


def test_single_person_group_returns_no_transfers() -> None:
    (alice,) = _ids(1)
    balances = {alice: Decimal("0.00")}

    assert simplify_debts(balances) == []


def test_empty_group_returns_no_transfers() -> None:
    assert simplify_debts({}) == []


def test_a_owes_b_only_produces_exactly_one_transfer() -> None:
    alice, bob = _ids(2)
    balances = {alice: Decimal("-50.00"), bob: Decimal("50.00")}

    transfers = simplify_debts(balances)

    assert transfers == [Transfer(from_user_id=alice, to_user_id=bob, amount=Decimal("50.00"))]


def test_cycle_of_equal_debts_nets_everyone_to_zero_and_produces_no_transfers() -> None:
    """A owes B 100, B owes C 100, C owes A 100: each member's *net* balance
    (§4) is already 0, so once reduced to balances there is nothing to settle
    -- the whole point of §5's motivating example.
    """
    alice, bob, carol = _ids(3)
    balances = {alice: Decimal("0.00"), bob: Decimal("0.00"), carol: Decimal("0.00")}

    assert simplify_debts(balances) == []


def test_many_people_many_amounts_transfer_count_at_most_n_minus_1() -> None:
    alice, bob, carol, dave, erin = _ids(5)
    balances = {
        alice: Decimal("120.00"),
        bob: Decimal("-30.00"),
        carol: Decimal("45.00"),
        dave: Decimal("-100.00"),
        erin: Decimal("-35.00"),
    }
    assert sum(balances.values(), start=Decimal("0.00")) == Decimal("0.00")

    transfers = simplify_debts(balances)

    assert len(transfers) <= len(balances) - 1
    assert _apply(balances, transfers) == dict.fromkeys(balances, Decimal("0.00"))


# --- property test --------------------------------------------------------


@st.composite
def _zero_sum_balances(draw: st.DrawFn) -> dict[uuid.UUID, Decimal]:
    """Random balances (cent-precision Decimals) that always sum to exactly
    zero: draw n-1 random cent amounts freely, then force the last
    participant's balance to be whatever makes the total zero.
    """
    n = draw(st.integers(min_value=1, max_value=30))
    user_ids = _ids(n)
    cents = draw(
        st.lists(
            st.integers(min_value=-100_000, max_value=100_000), min_size=n - 1, max_size=n - 1
        )
    )
    cents.append(-sum(cents))

    return {uid: Decimal(c) / 100 for uid, c in zip(user_ids, cents, strict=True)}


@settings(max_examples=500, deadline=None)
@given(balances=_zero_sum_balances())
def test_simplify_debts_property_zeroes_everyone_within_n_minus_1_transfers(
    balances: dict[uuid.UUID, Decimal],
) -> None:
    """§12: random balances summing to 0, >=500 examples. After applying every
    returned transfer, everyone must be at net 0, and the transfer count must
    be <= N-1.
    """
    transfers = simplify_debts(balances)

    assert len(transfers) <= max(len(balances) - 1, 0)
    assert _apply(balances, transfers) == dict.fromkeys(balances, Decimal("0.00"))
