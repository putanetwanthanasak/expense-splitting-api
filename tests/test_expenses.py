"""Expense CRUD integration tests (docs/SPEC.md §7, §8.2, §8.6, §9)."""

import uuid
from decimal import Decimal

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.models.expense_split import ExpenseSplit

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


# --- create: one test per split type -----------------------------------------


def test_create_expense_equal_split(client: TestClient) -> None:
    group_id, token, alice, bob, carol = _three_member_group(client)

    resp = client.post(
        f"/api/groups/{group_id}/expenses",
        json={
            "amount": "300.00",
            "description": "Dinner",
            "expense_date": _EXPENSE_DATE,
            "paid_by_user_id": alice,
            "split_type": "EQUAL",
            "participant_user_ids": [alice, bob, carol],
        },
        headers=_auth(token),
    )
    assert resp.status_code == 201, resp.text
    body = resp.json()
    splits = {s["user_id"]: Decimal(s["amount_owed"]) for s in body["splits"]}
    assert splits == {
        alice: Decimal("100.00"),
        bob: Decimal("100.00"),
        carol: Decimal("100.00"),
    }

    # Read it back independently via GET, not just the create response.
    detail = client.get(f"/api/expenses/{body['id']}", headers=_auth(token))
    assert detail.status_code == 200
    read_splits = {s["user_id"]: Decimal(s["amount_owed"]) for s in detail.json()["splits"]}
    assert read_splits == splits


def test_create_expense_exact_split(client: TestClient) -> None:
    group_id, token, alice, bob, carol = _three_member_group(client)

    resp = client.post(
        f"/api/groups/{group_id}/expenses",
        json={
            "amount": "300.00",
            "description": "Rent",
            "expense_date": _EXPENSE_DATE,
            "paid_by_user_id": alice,
            "split_type": "EXACT",
            "splits": [
                {"user_id": alice, "amount": "150.00"},
                {"user_id": bob, "amount": "100.00"},
                {"user_id": carol, "amount": "50.00"},
            ],
        },
        headers=_auth(token),
    )
    assert resp.status_code == 201, resp.text
    splits = {s["user_id"]: Decimal(s["amount_owed"]) for s in resp.json()["splits"]}
    assert splits == {
        alice: Decimal("150.00"),
        bob: Decimal("100.00"),
        carol: Decimal("50.00"),
    }


def test_create_expense_percentage_split(client: TestClient) -> None:
    group_id, token, alice, bob, carol = _three_member_group(client)

    resp = client.post(
        f"/api/groups/{group_id}/expenses",
        json={
            "amount": "100.00",
            "description": "Groceries",
            "expense_date": _EXPENSE_DATE,
            "paid_by_user_id": alice,
            "split_type": "PERCENTAGE",
            "splits": [
                {"user_id": alice, "percentage": "33.33"},
                {"user_id": bob, "percentage": "33.33"},
                {"user_id": carol, "percentage": "33.34"},
            ],
        },
        headers=_auth(token),
    )
    assert resp.status_code == 201, resp.text
    splits = {s["user_id"]: Decimal(s["amount_owed"]) for s in resp.json()["splits"]}
    assert splits == {
        alice: Decimal("33.33"),
        bob: Decimal("33.33"),
        carol: Decimal("33.34"),
    }


def test_create_expense_shares_split(client: TestClient) -> None:
    group_id, token, alice, bob, carol = _three_member_group(client)

    resp = client.post(
        f"/api/groups/{group_id}/expenses",
        json={
            "amount": "100.00",
            "description": "Hotel",
            "expense_date": _EXPENSE_DATE,
            "paid_by_user_id": alice,
            "split_type": "SHARES",
            "splits": [
                {"user_id": alice, "shares": "2"},
                {"user_id": bob, "shares": "1"},
                {"user_id": carol, "shares": "1"},
            ],
        },
        headers=_auth(token),
    )
    assert resp.status_code == 201, resp.text
    splits = {s["user_id"]: Decimal(s["amount_owed"]) for s in resp.json()["splits"]}
    assert splits == {
        alice: Decimal("50.00"),
        bob: Decimal("25.00"),
        carol: Decimal("25.00"),
    }


# --- rounding: the case that matters most -------------------------------------


def test_100_across_3_equal_splits_sum_to_exactly_100(client: TestClient) -> None:
    group_id, token, alice, bob, carol = _three_member_group(client)

    resp = client.post(
        f"/api/groups/{group_id}/expenses",
        json={
            "amount": "100.00",
            "description": "Cab",
            "expense_date": _EXPENSE_DATE,
            "paid_by_user_id": alice,
            "split_type": "EQUAL",
            "participant_user_ids": [alice, bob, carol],
        },
        headers=_auth(token),
    )
    assert resp.status_code == 201, resp.text
    amounts = [Decimal(s["amount_owed"]) for s in resp.json()["splits"]]
    assert sum(amounts, start=Decimal("0.00")) == Decimal("100.00")


# --- validation failures -------------------------------------------------------


def test_participant_outside_group_returns_400(client: TestClient) -> None:
    alice_id, alice_token = _new_user(client)
    bob_id, bob_token = _new_user(client)
    outsider_id, _ = _new_user(client)
    group_id = _create_group(client, alice_token)
    _add_member(client, alice_token, group_id, bob_id, bob_token)

    resp = client.post(
        f"/api/groups/{group_id}/expenses",
        json={
            "amount": "100.00",
            "description": "Dinner",
            "expense_date": _EXPENSE_DATE,
            "paid_by_user_id": alice_id,
            "split_type": "EQUAL",
            "participant_user_ids": [alice_id, bob_id, outsider_id],
        },
        headers=_auth(alice_token),
    )
    assert resp.status_code == 400


def test_payer_outside_group_returns_400(client: TestClient) -> None:
    alice_id, alice_token = _new_user(client)
    outsider_id, _ = _new_user(client)
    group_id = _create_group(client, alice_token)

    resp = client.post(
        f"/api/groups/{group_id}/expenses",
        json={
            "amount": "100.00",
            "description": "Dinner",
            "expense_date": _EXPENSE_DATE,
            "paid_by_user_id": outsider_id,
            "split_type": "EQUAL",
            "participant_user_ids": [alice_id],
        },
        headers=_auth(alice_token),
    )
    assert resp.status_code == 400


def test_duplicate_participant_returns_400(client: TestClient) -> None:
    alice_id, alice_token = _new_user(client)
    bob_id, bob_token = _new_user(client)
    group_id = _create_group(client, alice_token)
    _add_member(client, alice_token, group_id, bob_id, bob_token)

    resp = client.post(
        f"/api/groups/{group_id}/expenses",
        json={
            "amount": "100.00",
            "description": "Dinner",
            "expense_date": _EXPENSE_DATE,
            "paid_by_user_id": alice_id,
            "split_type": "EQUAL",
            "participant_user_ids": [alice_id, bob_id, bob_id],
        },
        headers=_auth(alice_token),
    )
    assert resp.status_code == 400


def test_zero_amount_returns_400(client: TestClient) -> None:
    alice_id, alice_token = _new_user(client)
    group_id = _create_group(client, alice_token)

    resp = client.post(
        f"/api/groups/{group_id}/expenses",
        json={
            "amount": "0.00",
            "description": "Nothing",
            "expense_date": _EXPENSE_DATE,
            "paid_by_user_id": alice_id,
            "split_type": "EQUAL",
            "participant_user_ids": [alice_id],
        },
        headers=_auth(alice_token),
    )
    assert resp.status_code == 400


def test_negative_amount_returns_400(client: TestClient) -> None:
    alice_id, alice_token = _new_user(client)
    group_id = _create_group(client, alice_token)

    resp = client.post(
        f"/api/groups/{group_id}/expenses",
        json={
            "amount": "-50.00",
            "description": "Refund?",
            "expense_date": _EXPENSE_DATE,
            "paid_by_user_id": alice_id,
            "split_type": "EQUAL",
            "participant_user_ids": [alice_id],
        },
        headers=_auth(alice_token),
    )
    assert resp.status_code == 400


def test_exact_split_mismatched_sum_returns_400(client: TestClient) -> None:
    # carol is a group member but deliberately left out of the request below --
    # that's what makes the EXACT amounts fail to sum to the total.
    group_id, token, alice, bob, _carol = _three_member_group(client)

    resp = client.post(
        f"/api/groups/{group_id}/expenses",
        json={
            "amount": "300.00",
            "description": "Dinner",
            "expense_date": _EXPENSE_DATE,
            "paid_by_user_id": alice,
            "split_type": "EXACT",
            "splits": [
                {"user_id": alice, "amount": "150.00"},
                {"user_id": bob, "amount": "100.00"},
                # missing carol's share -> sums to 250.00, not 300.00
            ],
        },
        headers=_auth(token),
    )
    assert resp.status_code == 400


# --- update ---------------------------------------------------------------------


def test_patch_from_equal_to_exact_replaces_all_splits(
    client: TestClient, db_session: Session
) -> None:
    group_id, token, alice, bob, carol = _three_member_group(client)

    created = _create_expense(
        client,
        token,
        group_id,
        paid_by_user_id=alice,
        split_type="EQUAL",
        participant_user_ids=[alice, bob, carol],
    )
    expense_id = str(created["id"])

    resp = client.patch(
        f"/api/expenses/{expense_id}",
        json={
            "amount": "300.00",
            "description": "Dinner (corrected)",
            "expense_date": _EXPENSE_DATE,
            "paid_by_user_id": alice,
            "split_type": "EXACT",
            "splits": [
                {"user_id": alice, "amount": "200.00"},
                {"user_id": bob, "amount": "100.00"},
            ],
        },
        headers=_auth(token),
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    splits = {s["user_id"]: Decimal(s["amount_owed"]) for s in body["splits"]}
    assert splits == {alice: Decimal("200.00"), bob: Decimal("100.00")}
    assert carol not in splits  # carol had a EQUAL share before; it's gone now

    # The old EQUAL splits are truly gone from the database, not just hidden by
    # the response shape -- exactly 2 rows remain for this expense, not 3.
    remaining = (
        db_session.query(ExpenseSplit)
        .filter(ExpenseSplit.expense_id == uuid.UUID(expense_id))
        .all()
    )
    assert len(remaining) == 2


# --- delete -----------------------------------------------------------------------


def test_delete_expense_deletes_its_splits(client: TestClient, db_session: Session) -> None:
    group_id, token, alice, bob, carol = _three_member_group(client)

    created = _create_expense(
        client,
        token,
        group_id,
        paid_by_user_id=alice,
        split_type="EQUAL",
        participant_user_ids=[alice, bob, carol],
    )
    expense_id = str(created["id"])

    resp = client.delete(f"/api/expenses/{expense_id}", headers=_auth(token))
    assert resp.status_code == 204

    remaining = (
        db_session.query(ExpenseSplit)
        .filter(ExpenseSplit.expense_id == uuid.UUID(expense_id))
        .all()
    )
    assert remaining == []

    get_resp = client.get(f"/api/expenses/{expense_id}", headers=_auth(token))
    assert get_resp.status_code == 404


# --- authorization ------------------------------------------------------------------


def test_non_member_gets_403_on_every_expense_endpoint(client: TestClient) -> None:
    group_id, owner_token, alice, bob, carol = _three_member_group(client)
    _, outsider_token = _new_user(client)

    created = _create_expense(
        client,
        owner_token,
        group_id,
        paid_by_user_id=alice,
        split_type="EQUAL",
        participant_user_ids=[alice, bob, carol],
    )
    expense_id = str(created["id"])

    create_resp = client.post(
        f"/api/groups/{group_id}/expenses",
        json={
            "amount": "50.00",
            "description": "Snacks",
            "expense_date": _EXPENSE_DATE,
            "paid_by_user_id": alice,
            "split_type": "EQUAL",
            "participant_user_ids": [alice],
        },
        headers=_auth(outsider_token),
    )
    assert create_resp.status_code == 403

    list_resp = client.get(f"/api/groups/{group_id}/expenses", headers=_auth(outsider_token))
    assert list_resp.status_code == 403

    get_resp = client.get(f"/api/expenses/{expense_id}", headers=_auth(outsider_token))
    assert get_resp.status_code == 403

    patch_resp = client.patch(
        f"/api/expenses/{expense_id}",
        json={
            "amount": "300.00",
            "description": "Dinner",
            "expense_date": _EXPENSE_DATE,
            "paid_by_user_id": alice,
            "split_type": "EQUAL",
            "participant_user_ids": [alice, bob, carol],
        },
        headers=_auth(outsider_token),
    )
    assert patch_resp.status_code == 403

    delete_resp = client.delete(f"/api/expenses/{expense_id}", headers=_auth(outsider_token))
    assert delete_resp.status_code == 403
