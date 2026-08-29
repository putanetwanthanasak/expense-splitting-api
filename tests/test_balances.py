"""Balance-calculation integration tests (docs/SPEC.md §4, §7, §8.1, §9, §12)."""

import uuid
from decimal import Decimal

from fastapi.testclient import TestClient

_EXPENSE_DATE = "2026-08-01"


def _signup(client: TestClient) -> dict[str, str]:
    payload = {
        "email": f"{uuid.uuid4()}@example.com",
        "password": "correct-horse-battery-staple",
        "name": "Test User",
    }
    resp = client.post("/api/auth/register", json=payload)
    assert resp.status_code == 201, resp.text
    return payload


def _login(client: TestClient, payload: dict[str, str]) -> str:
    resp = client.post(
        "/api/auth/login", json={"email": payload["email"], "password": payload["password"]}
    )
    assert resp.status_code == 200, resp.text
    token: str = resp.json()["access_token"]
    return token


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _new_user(client: TestClient) -> tuple[str, str]:
    """Register + log in a fresh user. Returns (user_id, token)."""
    payload = _signup(client)
    token = _login(client, payload)
    me = client.get("/api/users/me", headers=_auth(token))
    assert me.status_code == 200
    return me.json()["id"], token


def _create_group(client: TestClient, token: str, name: str = "Test Group") -> str:
    resp = client.post("/api/groups", json={"name": name}, headers=_auth(token))
    assert resp.status_code == 201, resp.text
    group_id: str = resp.json()["id"]
    return group_id


def _add_member(
    client: TestClient, owner_token: str, group_id: str, user_id: str, member_token: str
) -> None:
    """Invite user_id and have them accept, so they end up ACTIVE. Group
    membership now requires acceptance (§7.1); these tests predate that and
    assume adding someone makes them immediately usable in expenses/balances.
    """
    invite = client.post(
        f"/api/groups/{group_id}/members",
        json={"user_id": user_id},
        headers=_auth(owner_token),
    )
    assert invite.status_code == 201, invite.text
    accept = client.post(
        f"/api/groups/{group_id}/members/me/accept", headers=_auth(member_token)
    )
    assert accept.status_code == 200, accept.text


def _three_member_group(client: TestClient) -> tuple[str, str, str, str, str]:
    """A fresh group with 3 ACTIVE members. Returns (group_id, owner_token,
    alice_id, bob_id, carol_id) -- alice is the owner/creator.
    """
    alice_id, alice_token = _new_user(client)
    bob_id, bob_token = _new_user(client)
    carol_id, carol_token = _new_user(client)
    group_id = _create_group(client, alice_token)
    _add_member(client, alice_token, group_id, bob_id, bob_token)
    _add_member(client, alice_token, group_id, carol_id, carol_token)
    return group_id, alice_token, alice_id, bob_id, carol_id


def _create_expense(
    client: TestClient, token: str, group_id: str, **payload: object
) -> dict[str, object]:
    body = {
        "amount": "300.00",
        "description": "Dinner",
        "expense_date": _EXPENSE_DATE,
        **payload,
    }
    resp = client.post(f"/api/groups/{group_id}/expenses", json=body, headers=_auth(token))
    assert resp.status_code == 201, resp.text
    created: dict[str, object] = resp.json()
    return created


def _balances(client: TestClient, token: str, group_id: str) -> dict[str, Decimal]:
    resp = client.get(f"/api/groups/{group_id}/balances", headers=_auth(token))
    assert resp.status_code == 200, resp.text
    return {row["user_id"]: Decimal(row["net_balance"]) for row in resp.json()["balances"]}


# --- the worked example from §4 -----------------------------------------------


def test_worked_example_a_pays_300_split_equally_across_3(client: TestClient) -> None:
    group_id, token, alice, bob, carol = _three_member_group(client)

    _create_expense(
        client,
        token,
        group_id,
        amount="300.00",
        paid_by_user_id=alice,
        split_type="EQUAL",
        participant_user_ids=[alice, bob, carol],
    )

    balances = _balances(client, token, group_id)
    assert balances == {
        alice: Decimal("200.00"),
        bob: Decimal("-100.00"),
        carol: Decimal("-100.00"),
    }
    assert sum(balances.values(), start=Decimal("0.00")) == Decimal("0.00")


# --- self-payment (§9) ---------------------------------------------------------


def test_self_payment_nets_to_zero(client: TestClient) -> None:
    group_id, token, alice, _bob, _carol = _three_member_group(client)

    _create_expense(
        client,
        token,
        group_id,
        amount="100.00",
        paid_by_user_id=alice,
        split_type="EQUAL",
        participant_user_ids=[alice],
    )

    balances = _balances(client, token, group_id)
    assert balances[alice] == Decimal("0.00")
    assert sum(balances.values(), start=Decimal("0.00")) == Decimal("0.00")


# --- rounding: the extra cent shows up as a 0.01 asymmetry in the balances -----


def test_100_across_3_leaves_a_one_cent_asymmetry_but_group_still_sums_to_zero(
    client: TestClient,
) -> None:
    group_id, token, alice, bob, carol = _three_member_group(client)

    # Dave pays so that alice, bob and carol are all pure debtors -- isolates the
    # rounding asymmetry between the three of them without alice's own payment
    # muddying her balance.
    dave_id, dave_token = _new_user(client)
    _add_member(client, token, group_id, dave_id, dave_token)

    _create_expense(
        client,
        dave_token,
        group_id,
        amount="100.00",
        paid_by_user_id=dave_id,
        split_type="EQUAL",
        participant_user_ids=[alice, bob, carol],
    )

    balances = _balances(client, token, group_id)
    debtor_balances = sorted([balances[alice], balances[bob], balances[carol]])
    # largest remainder method (§6): one of the three owes 33.34, the other two
    # owe 33.33 -- a 0.01 difference between the extra-cent recipient and the rest.
    assert debtor_balances == [Decimal("-33.34"), Decimal("-33.33"), Decimal("-33.33")]
    assert sum(balances.values(), start=Decimal("0.00")) == Decimal("0.00")


# --- add / edit / delete keep the group summed to zero -------------------------


def test_group_sums_to_zero_after_add_edit_delete_expense(client: TestClient) -> None:
    group_id, token, alice, bob, carol = _three_member_group(client)

    created = _create_expense(
        client,
        token,
        group_id,
        amount="300.00",
        paid_by_user_id=alice,
        split_type="EQUAL",
        participant_user_ids=[alice, bob, carol],
    )
    balances = _balances(client, token, group_id)
    assert sum(balances.values(), start=Decimal("0.00")) == Decimal("0.00")

    expense_id = str(created["id"])
    patch_resp = client.patch(
        f"/api/expenses/{expense_id}",
        json={
            "amount": "300.00",
            "description": "Dinner (corrected)",
            "expense_date": _EXPENSE_DATE,
            "paid_by_user_id": bob,
            "split_type": "EXACT",
            "splits": [
                {"user_id": alice, "amount": "200.00"},
                {"user_id": bob, "amount": "100.00"},
            ],
        },
        headers=_auth(token),
    )
    assert patch_resp.status_code == 200, patch_resp.text
    balances = _balances(client, token, group_id)
    assert sum(balances.values(), start=Decimal("0.00")) == Decimal("0.00")
    assert carol not in balances or balances[carol] == Decimal("0.00")

    delete_resp = client.delete(f"/api/expenses/{expense_id}", headers=_auth(token))
    assert delete_resp.status_code == 204
    balances = _balances(client, token, group_id)
    assert balances == {
        alice: Decimal("0.00"),
        bob: Decimal("0.00"),
        carol: Decimal("0.00"),
    }


# --- GET /settle-up (§5, §7) ----------------------------------------------------


def test_settle_up_returns_simplified_transfers_and_the_required_note(
    client: TestClient,
) -> None:
    group_id, token, alice, bob, carol = _three_member_group(client)

    _create_expense(
        client,
        token,
        group_id,
        amount="300.00",
        paid_by_user_id=alice,
        split_type="EQUAL",
        participant_user_ids=[alice, bob, carol],
    )

    resp = client.get(f"/api/groups/{group_id}/settle-up", headers=_auth(token))
    assert resp.status_code == 200, resp.text
    body = resp.json()

    transfers = {
        (t["from_user_id"], t["to_user_id"]): Decimal(t["amount"]) for t in body["transfers"]
    }
    assert transfers == {
        (bob, alice): Decimal("100.00"),
        (carol, alice): Decimal("100.00"),
    }
    assert body["note"] == (
        "Simplified using greedy matching; guarantees at most N-1 transfers, "
        "not a proven minimum."
    )


def test_settle_up_on_a_settled_group_returns_no_transfers(client: TestClient) -> None:
    group_id, token, _alice, _bob, _carol = _three_member_group(client)

    resp = client.get(f"/api/groups/{group_id}/settle-up", headers=_auth(token))
    assert resp.status_code == 200, resp.text
    assert resp.json()["transfers"] == []


# --- authorization (§8.5) --------------------------------------------------------


def test_non_member_gets_403_on_balances_and_settle_up(client: TestClient) -> None:
    group_id, _owner_token, *_ = _three_member_group(client)
    _, outsider_token = _new_user(client)

    balances_resp = client.get(
        f"/api/groups/{group_id}/balances", headers=_auth(outsider_token)
    )
    assert balances_resp.status_code == 403

    settle_up_resp = client.get(
        f"/api/groups/{group_id}/settle-up", headers=_auth(outsider_token)
    )
    assert settle_up_resp.status_code == 403
