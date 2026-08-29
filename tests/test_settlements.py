"""Settlement integration tests (docs/SPEC.md §4, §7, §8.7, §9)."""

import uuid
from datetime import UTC, datetime
from decimal import Decimal

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.models.settlement import Settlement

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


# --- recording updates both sides' balances -------------------------------------


def test_recording_a_settlement_updates_both_sides_balances(client: TestClient) -> None:
    group_id, token, alice, bob, _carol = _three_member_group(client)

    # Give bob something to owe first -- otherwise any settlement he makes is
    # by definition an overpayment (§9), which is a different, separately
    # tested case.
    _create_expense(
        client,
        token,
        group_id,
        amount="80.00",
        paid_by_user_id=alice,
        split_type="EQUAL",
        participant_user_ids=[alice, bob],
    )

    resp = client.post(
        f"/api/groups/{group_id}/settlements",
        json={"from_user_id": bob, "to_user_id": alice, "amount": "40.00"},
        headers=_auth(token),
    )
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["from_user_id"] == bob
    assert body["to_user_id"] == alice
    assert Decimal(body["amount"]) == Decimal("40.00")
    assert body["warning"] is None

    balances = _balances(client, token, group_id)
    assert balances[bob] == Decimal("0.00")
    assert balances[alice] == Decimal("0.00")
    assert sum(balances.values(), start=Decimal("0.00")) == Decimal("0.00")


# --- the full worked example from §4 --------------------------------------------


def test_worked_example_a_pays_300_then_b_repays_100(client: TestClient) -> None:
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

    settle_resp = client.post(
        f"/api/groups/{group_id}/settlements",
        json={"from_user_id": bob, "to_user_id": alice, "amount": "100.00"},
        headers=_auth(token),
    )
    assert settle_resp.status_code == 201, settle_resp.text
    assert settle_resp.json()["warning"] is None

    balances = _balances(client, token, group_id)
    assert balances == {
        alice: Decimal("100.00"),
        bob: Decimal("0.00"),
        carol: Decimal("-100.00"),
    }
    assert sum(balances.values(), start=Decimal("0.00")) == Decimal("0.00")


# --- history, newest first -------------------------------------------------------


def test_settlement_history_is_newest_first(client: TestClient, db_session: Session) -> None:
    """Inserted directly with explicit, distinct settled_at timestamps rather
    than via two back-to-back API calls: settled_at's server_default is
    func.now(), which is *transaction* time in Postgres and would tie for two
    inserts made within this test's single wrapping transaction (§10.7),
    making an API-only version of this test flaky rather than a genuine check
    of the ORDER BY.
    """
    group_id, token, alice, bob, _carol = _three_member_group(client)

    older = Settlement(
        group_id=uuid.UUID(group_id),
        from_user_id=uuid.UUID(bob),
        to_user_id=uuid.UUID(alice),
        amount=Decimal("10.00"),
        settled_at=datetime(2026, 1, 1, tzinfo=UTC),
    )
    newer = Settlement(
        group_id=uuid.UUID(group_id),
        from_user_id=uuid.UUID(alice),
        to_user_id=uuid.UUID(bob),
        amount=Decimal("5.00"),
        settled_at=datetime(2026, 1, 2, tzinfo=UTC),
    )
    db_session.add_all([older, newer])
    db_session.commit()

    history = client.get(f"/api/groups/{group_id}/settlements", headers=_auth(token))
    assert history.status_code == 200, history.text
    ids = [row["id"] for row in history.json()]
    assert ids == [str(newer.id), str(older.id)]


# --- validation failures ----------------------------------------------------------


def test_settlement_from_equals_to_returns_400(client: TestClient) -> None:
    group_id, token, alice, _bob, _carol = _three_member_group(client)

    resp = client.post(
        f"/api/groups/{group_id}/settlements",
        json={"from_user_id": alice, "to_user_id": alice, "amount": "10.00"},
        headers=_auth(token),
    )
    assert resp.status_code == 400


def test_settlement_zero_amount_returns_400(client: TestClient) -> None:
    group_id, token, alice, bob, _carol = _three_member_group(client)

    resp = client.post(
        f"/api/groups/{group_id}/settlements",
        json={"from_user_id": bob, "to_user_id": alice, "amount": "0.00"},
        headers=_auth(token),
    )
    assert resp.status_code == 400


def test_settlement_negative_amount_returns_400(client: TestClient) -> None:
    group_id, token, alice, bob, _carol = _three_member_group(client)

    resp = client.post(
        f"/api/groups/{group_id}/settlements",
        json={"from_user_id": bob, "to_user_id": alice, "amount": "-10.00"},
        headers=_auth(token),
    )
    assert resp.status_code == 400


def test_settlement_with_user_outside_group_returns_400(client: TestClient) -> None:
    group_id, token, alice, _bob, _carol = _three_member_group(client)
    outsider_id, _ = _new_user(client)

    resp = client.post(
        f"/api/groups/{group_id}/settlements",
        json={"from_user_id": outsider_id, "to_user_id": alice, "amount": "10.00"},
        headers=_auth(token),
    )
    assert resp.status_code == 400


# --- overpayment ------------------------------------------------------------------


def test_overpayment_succeeds_with_warning_and_flips_net_balance_sign(
    client: TestClient,
) -> None:
    group_id, token, alice, bob, _carol = _three_member_group(client)

    # bob owes alice 100.
    _create_expense(
        client,
        token,
        group_id,
        amount="200.00",
        paid_by_user_id=alice,
        split_type="EQUAL",
        participant_user_ids=[alice, bob],
    )
    balances = _balances(client, token, group_id)
    assert balances[bob] == Decimal("-100.00")

    resp = client.post(
        f"/api/groups/{group_id}/settlements",
        json={"from_user_id": bob, "to_user_id": alice, "amount": "150.00"},
        headers=_auth(token),
    )
    assert resp.status_code == 201, resp.text
    assert resp.json()["warning"]

    balances = _balances(client, token, group_id)
    assert balances[bob] == Decimal("50.00")  # flipped from negative to positive
    assert balances[alice] == Decimal("-50.00")
    assert sum(balances.values(), start=Decimal("0.00")) == Decimal("0.00")


# --- member removal (closing the Phase 4 TODO) ------------------------------------


def test_removing_member_with_outstanding_balance_returns_409_with_amount(
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

    resp = client.delete(f"/api/groups/{group_id}/members/{bob}", headers=_auth(token))
    assert resp.status_code == 409
    body = resp.json()
    assert body["detail"]["outstanding_balance"] == "-100.00"

    # Bob is still a member -- the removal was refused, not silently partial.
    detail = client.get(f"/api/groups/{group_id}", headers=_auth(token))
    member_ids = {m["user_id"] for m in detail.json()["members"]}
    assert bob in member_ids


def test_removing_member_at_net_zero_keeps_expense_history(client: TestClient) -> None:
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
    expense_id = created["id"]

    # Settle bob up to net 0 before removing him.
    settle_resp = client.post(
        f"/api/groups/{group_id}/settlements",
        json={"from_user_id": bob, "to_user_id": alice, "amount": "100.00"},
        headers=_auth(token),
    )
    assert settle_resp.status_code == 201, settle_resp.text
    balances = _balances(client, token, group_id)
    assert balances[bob] == Decimal("0.00")

    resp = client.delete(f"/api/groups/{group_id}/members/{bob}", headers=_auth(token))
    assert resp.status_code == 204, resp.text

    detail = client.get(f"/api/groups/{group_id}", headers=_auth(token))
    member_ids = {m["user_id"] for m in detail.json()["members"]}
    assert bob not in member_ids

    # The expense (and bob's own split within it) is still there.
    expense_detail = client.get(f"/api/expenses/{expense_id}", headers=_auth(token))
    assert expense_detail.status_code == 200, expense_detail.text
    split_user_ids = {s["user_id"] for s in expense_detail.json()["splits"]}
    assert bob in split_user_ids

    list_resp = client.get(f"/api/groups/{group_id}/expenses", headers=_auth(token))
    assert list_resp.status_code == 200
    assert any(e["id"] == expense_id for e in list_resp.json()["items"])
