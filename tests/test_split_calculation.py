"""Split-calculation unit tests (docs/SPEC.md §6, §12). The most important file
in the suite — everything here is pure logic, no database required, so every
case is a direct, fast check on the largest remainder method itself.
"""

import uuid
from decimal import Decimal

import pytest
from hypothesis import given, settings
from hypothesis import strategies as st

from app.services.splitting import (
    SplitValidationError,
    split_by_percentage,
    split_by_shares,
    split_equally,
    split_exact,
)


def _ids(n: int) -> list[uuid.UUID]:
    return [uuid.uuid4() for _ in range(n)]


# --- split_equally --------------------------------------------------------


def test_split_equally_300_across_3_divides_evenly() -> None:
    alice, bob, carol = _ids(3)
    result = split_equally(Decimal("300"), [alice, bob, carol])

    assert result == {
        alice: Decimal("100.00"),
        bob: Decimal("100.00"),
        carol: Decimal("100.00"),
    }
    assert sum(result.values(), start=Decimal("0.00")) == Decimal("300.00")


def test_split_equally_100_across_3_gives_extra_cent_to_first_participant() -> None:
    alice, bob, carol = _ids(3)
    result = split_equally(Decimal("100"), [alice, bob, carol])

    assert result == {
        alice: Decimal("33.34"),
        bob: Decimal("33.33"),
        carol: Decimal("33.33"),
    }
    assert sum(result.values(), start=Decimal("0.00")) == Decimal("100.00")


def test_split_equally_one_cent_across_3_does_not_raise() -> None:
    alice, bob, carol = _ids(3)
    result = split_equally(Decimal("0.01"), [alice, bob, carol])

    assert result == {
        alice: Decimal("0.01"),
        bob: Decimal("0.00"),
        carol: Decimal("0.00"),
    }
    assert sum(result.values(), start=Decimal("0.00")) == Decimal("0.01")


def test_split_equally_100_across_1_person() -> None:
    (alice,) = _ids(1)
    result = split_equally(Decimal("100"), [alice])

    assert result == {alice: Decimal("100.00")}


def test_split_equally_remainder_order_follows_input_order_not_creation_order() -> None:
    """§8.8: the extra cent goes to whoever is first in the *input list*,
    regardless of any other ordering (e.g. UUID sort order).
    """
    alice, bob, carol = _ids(3)

    result = split_equally(Decimal("100"), [carol, alice, bob])

    assert result[carol] == Decimal("33.34")
    assert result[alice] == Decimal("33.33")
    assert result[bob] == Decimal("33.33")


def test_split_equally_empty_participant_list_raises() -> None:
    with pytest.raises(SplitValidationError):
        split_equally(Decimal("100"), [])


def test_split_equally_duplicate_participant_raises() -> None:
    (alice,) = _ids(1)
    with pytest.raises(SplitValidationError):
        split_equally(Decimal("100"), [alice, alice])


# --- split_exact ------------------------------------------------------------


def test_split_exact_matching_sum() -> None:
    alice, bob, carol = _ids(3)
    result = split_exact(
        Decimal("300"),
        {alice: Decimal("150.00"), bob: Decimal("100.00"), carol: Decimal("50.00")},
    )

    assert result == {
        alice: Decimal("150.00"),
        bob: Decimal("100.00"),
        carol: Decimal("50.00"),
    }


def test_split_exact_mismatched_sum_raises() -> None:
    alice, bob = _ids(2)
    with pytest.raises(SplitValidationError):
        split_exact(Decimal("300"), {alice: Decimal("150.00"), bob: Decimal("100.00")})


def test_split_exact_empty_raises() -> None:
    with pytest.raises(SplitValidationError):
        split_exact(Decimal("100"), {})


# --- split_by_percentage -----------------------------------------------------


def test_split_by_percentage_33_33_34_of_100() -> None:
    alice, bob, carol = _ids(3)
    result = split_by_percentage(
        Decimal("100"),
        {alice: Decimal("33.33"), bob: Decimal("33.33"), carol: Decimal("33.34")},
    )

    assert result == {
        alice: Decimal("33.33"),
        bob: Decimal("33.33"),
        carol: Decimal("33.34"),
    }
    assert sum(result.values(), start=Decimal("0.00")) == Decimal("100.00")


def test_split_by_percentage_not_summing_to_100_raises() -> None:
    alice, bob = _ids(2)
    with pytest.raises(SplitValidationError):
        split_by_percentage(Decimal("100"), {alice: Decimal("50"), bob: Decimal("40")})


def test_split_by_percentage_empty_raises() -> None:
    with pytest.raises(SplitValidationError):
        split_by_percentage(Decimal("100"), {})


# --- split_by_shares ----------------------------------------------------------


def test_split_by_shares_2_1_1_of_100() -> None:
    alice, bob, carol = _ids(3)
    result = split_by_shares(
        Decimal("100"),
        {alice: Decimal("2"), bob: Decimal("1"), carol: Decimal("1")},
    )

    assert result == {
        alice: Decimal("50.00"),
        bob: Decimal("25.00"),
        carol: Decimal("25.00"),
    }
    assert sum(result.values(), start=Decimal("0.00")) == Decimal("100.00")


def test_split_by_shares_zero_share_raises() -> None:
    alice, bob = _ids(2)
    with pytest.raises(SplitValidationError):
        split_by_shares(Decimal("100"), {alice: Decimal("1"), bob: Decimal("0")})


def test_split_by_shares_negative_share_raises() -> None:
    alice, bob = _ids(2)
    with pytest.raises(SplitValidationError):
        split_by_shares(Decimal("100"), {alice: Decimal("2"), bob: Decimal("-1")})


def test_split_by_shares_empty_raises() -> None:
    with pytest.raises(SplitValidationError):
        split_by_shares(Decimal("100"), {})


# --- property test ------------------------------------------------------------

_money = st.decimals(min_value=Decimal("0.01"), max_value=Decimal("999999.99"), places=2)
_participant_counts = st.integers(min_value=1, max_value=50)


@settings(max_examples=1000, deadline=None)
@given(total=_money, n=_participant_counts)
def test_split_equally_property_always_sums_exactly_and_never_negative(
    total: Decimal, n: int
) -> None:
    """§12: random total (0.01-999999.99) and random participant count (1-50),
    >=1000 examples. The split must always sum to the total exactly and every
    share must be >= 0.
    """
    user_ids = _ids(n)
    result = split_equally(total, user_ids)

    assert sum(result.values(), start=Decimal("0.00")) == total
    assert all(share >= Decimal("0.00") for share in result.values())
    assert set(result.keys()) == set(user_ids)
