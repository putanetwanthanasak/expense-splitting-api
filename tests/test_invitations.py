"""Group membership acceptance — PENDING / ACTIVE (docs/SPEC.md §7.1, §8.5, §9).

Adding someone to a group now creates a PENDING invitation, not a membership.
Until they accept, a PENDING member is indistinguishable from a stranger for
every purpose: group-scoped access (§8.5), balances (§4), expense participation
(§8.6). Their only valid actions are accept and decline.

The §8.1 autouse fixture (`_assert_balances_sum_to_zero` in conftest) runs after
every test here too — so "balances still sum to zero through every scenario" is
asserted for free, not just where a test mentions it.
"""

import uuid

import pytest
from fastapi.testclient import TestClient


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _new_user(client: TestClient) -> tuple[str, str, str]:
    """Register + log in a fresh user. Returns (user_id, token, email)."""
    email = f"{uuid.uuid4()}@example.com"
    password = "correct-horse-battery-staple"
    reg = client.post(
        "/api/auth/register", json={"email": email, "password": password, "name": "Test User"}
    )
    assert reg.status_code == 201, reg.text
    login = client.post("/api/auth/login", json={"email": email, "password": password})
    assert login.status_code == 200, login.text
    token = login.json()["access_token"]
    me = client.get("/api/users/me", headers=_auth(token))
    assert me.status_code == 200
    return me.json()["id"], token, email


def _create_group(client: TestClient, token: str, name: str = "Trip") -> str:
    resp = client.post("/api/groups", json={"name": name}, headers=_auth(token))
    assert resp.status_code == 201, resp.text
    return str(resp.json()["id"])


def _invite(client: TestClient, owner_token: str, group_id: str, user_id: str) -> None:
    resp = client.post(
        f"/api/groups/{group_id}/members",
        json={"user_id": user_id},
        headers=_auth(owner_token),
    )
    assert resp.status_code == 201, resp.text


def _accept(client: TestClient, token: str, group_id: str) -> None:
    resp = client.post(
        f"/api/groups/{group_id}/members/me/accept", headers=_auth(token)
    )
    assert resp.status_code == 200, resp.text


def _make_expense(
    client: TestClient, token: str, group_id: str, *, payer: str, participants: list[str]
) -> None:
    resp = client.post(
        f"/api/groups/{group_id}/expenses",
        json={
            "amount": "300.00",
            "description": "Dinner",
            "expense_date": "2026-08-14",
            "paid_by_user_id": payer,
            "split_type": "EQUAL",
            "participant_user_ids": participants,
        },
        headers=_auth(token),
    )
    assert resp.status_code == 201, resp.text


# --- users/lookup ---------------------------------------------------------


def test_users_lookup_finds_an_existing_user(client: TestClient) -> None:
    _, alice_token, _ = _new_user(client)
    bob_id, _, bob_email = _new_user(client)

    resp = client.get(
        "/api/users/lookup", params={"email": bob_email}, headers=_auth(alice_token)
    )
    assert resp.status_code == 200
    assert resp.json() == {"id": bob_id, "email": bob_email, "name": "Test User"}


def test_users_lookup_unknown_email_returns_404(client: TestClient) -> None:
    _, token, _ = _new_user(client)
    resp = client.get(
        "/api/users/lookup",
        params={"email": f"{uuid.uuid4()}@nope.com"},
        headers=_auth(token),
    )
    assert resp.status_code == 404


def test_users_lookup_requires_authentication(client: TestClient) -> None:
    _, _, email = _new_user(client)
    resp = client.get("/api/users/lookup", params={"email": email})
    assert resp.status_code == 401


# --- inviting creates PENDING, not a membership --------------------------


def test_inviting_creates_a_pending_row_not_an_active_membership(client: TestClient) -> None:
    _, owner_token, _ = _new_user(client)
    bob_id, bob_token, _ = _new_user(client)
    group_id = _create_group(client, owner_token)

    _invite(client, owner_token, group_id, bob_id)

    # Visible in the group's member list (to an ACTIVE member) as PENDING...
    detail = client.get(f"/api/groups/{group_id}", headers=_auth(owner_token))
    assert detail.status_code == 200
    members_by_id = {m["user_id"]: m for m in detail.json()["members"]}
    assert members_by_id[bob_id]["status"] == "PENDING"

    # ...not in Bob's group list...
    assert client.get("/api/groups", headers=_auth(bob_token)).json() == []

    # ...but it does show up as a pending invitation for Bob.
    invites = client.get("/api/me/invitations", headers=_auth(bob_token))
    assert invites.status_code == 200
    assert [i["group_id"] for i in invites.json()] == [group_id]


def test_reinviting_a_pending_user_is_409(client: TestClient) -> None:
    _, owner_token, _ = _new_user(client)
    bob_id, _, _ = _new_user(client)
    group_id = _create_group(client, owner_token)

    _invite(client, owner_token, group_id, bob_id)
    again = client.post(
        f"/api/groups/{group_id}/members",
        json={"user_id": bob_id},
        headers=_auth(owner_token),
    )
    assert again.status_code == 409


def test_inviting_a_nonexistent_user_is_still_400(client: TestClient) -> None:
    _, owner_token, _ = _new_user(client)
    group_id = _create_group(client, owner_token)
    resp = client.post(
        f"/api/groups/{group_id}/members",
        json={"user_id": str(uuid.uuid4())},
        headers=_auth(owner_token),
    )
    assert resp.status_code == 400


# --- a PENDING member is treated exactly like a stranger (§8.5) ---------

_GROUP_SCOPED_REQUESTS = [
    ("GET", "/api/groups/{gid}"),
    ("GET", "/api/groups/{gid}/expenses"),
    ("GET", "/api/groups/{gid}/balances"),
    ("GET", "/api/groups/{gid}/settle-up"),
    ("GET", "/api/groups/{gid}/settlements"),
]


@pytest.mark.parametrize(("method", "path"), _GROUP_SCOPED_REQUESTS)
def test_pending_member_gets_403_on_group_scoped_endpoints(
    client: TestClient, method: str, path: str
) -> None:
    _, owner_token, _ = _new_user(client)
    bob_id, bob_token, _ = _new_user(client)
    outsider_id, outsider_token, _ = _new_user(client)
    group_id = _create_group(client, owner_token)
    _invite(client, owner_token, group_id, bob_id)

    url = path.format(gid=group_id)
    pending_resp = client.request(method, url, headers=_auth(bob_token))
    stranger_resp = client.request(method, url, headers=_auth(outsider_token))

    assert pending_resp.status_code == 403
    assert stranger_resp.status_code == 403


def test_pending_member_cannot_post_expenses_or_settlements(client: TestClient) -> None:
    _, owner_token, _ = _new_user(client)
    bob_id, bob_token, _ = _new_user(client)
    group_id = _create_group(client, owner_token)
    _invite(client, owner_token, group_id, bob_id)

    expense = client.post(
        f"/api/groups/{group_id}/expenses",
        json={
            "amount": "10.00",
            "description": "x",
            "expense_date": "2026-08-14",
            "paid_by_user_id": bob_id,
            "split_type": "EQUAL",
            "participant_user_ids": [bob_id],
        },
        headers=_auth(bob_token),
    )
    assert expense.status_code == 403

    settlement = client.post(
        f"/api/groups/{group_id}/settlements",
        json={"from_user_id": bob_id, "to_user_id": bob_id, "amount": "1.00"},
        headers=_auth(bob_token),
    )
    assert settlement.status_code == 403


# --- accept / decline --------------------------------------------------


def test_accept_flips_pending_to_active_and_grants_access(client: TestClient) -> None:
    _, owner_token, _ = _new_user(client)
    bob_id, bob_token, _ = _new_user(client)
    group_id = _create_group(client, owner_token)
    _invite(client, owner_token, group_id, bob_id)

    # Before: 403.
    assert client.get(f"/api/groups/{group_id}", headers=_auth(bob_token)).status_code == 403

    accept = client.post(
        f"/api/groups/{group_id}/members/me/accept", headers=_auth(bob_token)
    )
    assert accept.status_code == 200
    assert accept.json()["user_id"] == bob_id

    # After: full access, and no longer a pending invitation.
    detail = client.get(f"/api/groups/{group_id}", headers=_auth(bob_token))
    assert detail.status_code == 200
    assert bob_id in {m["user_id"] for m in detail.json()["members"]}
    assert client.get("/api/me/invitations", headers=_auth(bob_token)).json() == []
    assert [g["id"] for g in client.get("/api/groups", headers=_auth(bob_token)).json()] == [
        group_id
    ]


def test_decline_removes_the_row_entirely(client: TestClient) -> None:
    _, owner_token, _ = _new_user(client)
    bob_id, bob_token, _ = _new_user(client)
    group_id = _create_group(client, owner_token)
    _invite(client, owner_token, group_id, bob_id)

    decline = client.post(
        f"/api/groups/{group_id}/members/me/decline", headers=_auth(bob_token)
    )
    assert decline.status_code == 204

    # The invitation is gone: no pending invite, and declining again is a 404
    # (there is no row at all any more, not a declined one).
    assert client.get("/api/me/invitations", headers=_auth(bob_token)).json() == []
    again = client.post(
        f"/api/groups/{group_id}/members/me/decline", headers=_auth(bob_token)
    )
    assert again.status_code == 404


@pytest.mark.parametrize("action", ["accept", "decline"])
def test_accept_or_decline_with_no_pending_row_is_404(
    client: TestClient, action: str
) -> None:
    _, owner_token, _ = _new_user(client)
    _, bob_token, _ = _new_user(client)  # never invited
    group_id = _create_group(client, owner_token)

    # never invited
    never = client.post(
        f"/api/groups/{group_id}/members/me/{action}", headers=_auth(bob_token)
    )
    assert never.status_code == 404

    # already ACTIVE (the owner): no PENDING row for them either
    already_active = client.post(
        f"/api/groups/{group_id}/members/me/{action}", headers=_auth(owner_token)
    )
    assert already_active.status_code == 404


@pytest.mark.parametrize("action", ["accept", "decline"])
def test_one_user_cannot_act_on_another_users_invitation(
    client: TestClient, action: str
) -> None:
    _, owner_token, _ = _new_user(client)
    carol_id, carol_token, _ = _new_user(client)
    _, mallory_token, _ = _new_user(client)
    group_id = _create_group(client, owner_token)
    _invite(client, owner_token, group_id, carol_id)

    # Mallory hitting the endpoint acts only on Mallory's own (nonexistent) row.
    resp = client.post(
        f"/api/groups/{group_id}/members/me/{action}", headers=_auth(mallory_token)
    )
    assert resp.status_code == 404

    # Carol's invitation is untouched — still pending, still acceptable.
    assert [i["group_id"] for i in client.get(
        "/api/me/invitations", headers=_auth(carol_token)
    ).json()] == [group_id]
    assert client.post(
        f"/api/groups/{group_id}/members/me/accept", headers=_auth(carol_token)
    ).status_code == 200


# --- GET /api/me/invitations ----------------------------------------------


def test_invitations_lists_group_id_name_and_invited_at(client: TestClient) -> None:
    _, owner_token, _ = _new_user(client)
    bob_id, bob_token, _ = _new_user(client)
    group_id = _create_group(client, owner_token, name="Ski trip")
    _invite(client, owner_token, group_id, bob_id)

    invites = client.get("/api/me/invitations", headers=_auth(bob_token))
    assert invites.status_code == 200
    body = invites.json()
    assert len(body) == 1
    assert body[0]["group_id"] == group_id
    assert body[0]["group_name"] == "Ski trip"
    assert "invited_at" in body[0]


def test_invitations_is_empty_once_accepted(client: TestClient) -> None:
    _, owner_token, _ = _new_user(client)
    bob_id, bob_token, _ = _new_user(client)
    group_id = _create_group(client, owner_token)
    _invite(client, owner_token, group_id, bob_id)
    _accept(client, bob_token, group_id)

    assert client.get("/api/me/invitations", headers=_auth(bob_token)).json() == []


# --- PENDING members and expenses / balances (§8.6, §4) -----------------


def test_pending_member_id_as_participant_or_payer_is_400(client: TestClient) -> None:
    alice_id, alice_token, _ = _new_user(client)
    bob_id, _, _ = _new_user(client)
    group_id = _create_group(client, alice_token)
    _invite(client, alice_token, group_id, bob_id)  # bob is PENDING

    as_participant = client.post(
        f"/api/groups/{group_id}/expenses",
        json={
            "amount": "100.00",
            "description": "Dinner",
            "expense_date": "2026-08-14",
            "paid_by_user_id": alice_id,
            "split_type": "EQUAL",
            "participant_user_ids": [alice_id, bob_id],
        },
        headers=_auth(alice_token),
    )
    assert as_participant.status_code == 400

    as_payer = client.post(
        f"/api/groups/{group_id}/expenses",
        json={
            "amount": "100.00",
            "description": "Dinner",
            "expense_date": "2026-08-14",
            "paid_by_user_id": bob_id,
            "split_type": "EQUAL",
            "participant_user_ids": [alice_id],
        },
        headers=_auth(alice_token),
    )
    assert as_payer.status_code == 400


def test_balances_and_settle_up_never_include_a_pending_member(client: TestClient) -> None:
    alice_id, alice_token, _ = _new_user(client)
    bob_id, bob_token, _ = _new_user(client)
    carol_id, _, _ = _new_user(client)
    group_id = _create_group(client, alice_token)

    _invite(client, alice_token, group_id, bob_id)
    _accept(client, bob_token, group_id)  # bob ACTIVE
    _invite(client, alice_token, group_id, carol_id)  # carol PENDING

    _make_expense(client, alice_token, group_id, payer=alice_id, participants=[alice_id, bob_id])

    balances = client.get(f"/api/groups/{group_id}/balances", headers=_auth(alice_token))
    assert balances.status_code == 200
    balance_ids = {b["user_id"] for b in balances.json()["balances"]}
    assert balance_ids == {alice_id, bob_id}
    assert carol_id not in balance_ids

    settle = client.get(f"/api/groups/{group_id}/settle-up", headers=_auth(alice_token))
    assert settle.status_code == 200
    touched = {t["from_user_id"] for t in settle.json()["transfers"]} | {
        t["to_user_id"] for t in settle.json()["transfers"]
    }
    assert carol_id not in touched


def test_settlement_naming_a_pending_member_is_400(client: TestClient) -> None:
    alice_id, alice_token, _ = _new_user(client)
    bob_id, _, _ = _new_user(client)
    group_id = _create_group(client, alice_token)
    _invite(client, alice_token, group_id, bob_id)  # PENDING

    resp = client.post(
        f"/api/groups/{group_id}/settlements",
        json={"from_user_id": alice_id, "to_user_id": bob_id, "amount": "5.00"},
        headers=_auth(alice_token),
    )
    assert resp.status_code == 400


# --- DELETE doubles as "revoke invitation" (§9) -----------------------


def test_delete_on_a_pending_member_always_succeeds(client: TestClient) -> None:
    _, owner_token, _ = _new_user(client)
    bob_id, bob_token, _ = _new_user(client)
    group_id = _create_group(client, owner_token)
    _invite(client, owner_token, group_id, bob_id)

    resp = client.delete(
        f"/api/groups/{group_id}/members/{bob_id}", headers=_auth(owner_token)
    )
    assert resp.status_code == 204

    # The invitation is fully revoked.
    assert client.get("/api/me/invitations", headers=_auth(bob_token)).json() == []
    # And accepting now 404s — there is no row to accept.
    assert client.post(
        f"/api/groups/{group_id}/members/me/accept", headers=_auth(bob_token)
    ).status_code == 404


def test_delete_on_active_member_with_nonzero_balance_still_409(client: TestClient) -> None:
    """Regression: the pre-existing §9 rule is unchanged for ACTIVE members."""
    alice_id, alice_token, _ = _new_user(client)
    bob_id, bob_token, _ = _new_user(client)
    carol_id, carol_token, _ = _new_user(client)
    group_id = _create_group(client, alice_token)
    for uid, tok in ((bob_id, bob_token), (carol_id, carol_token)):
        _invite(client, alice_token, group_id, uid)
        _accept(client, tok, group_id)

    _make_expense(
        client, alice_token, group_id, payer=alice_id, participants=[alice_id, bob_id, carol_id]
    )

    resp = client.delete(
        f"/api/groups/{group_id}/members/{bob_id}", headers=_auth(alice_token)
    )
    assert resp.status_code == 409
    assert resp.json()["detail"]["outstanding_balance"] == "-100.00"


# --- GET /api/groups/{id} member list includes PENDING rows (§7.1) ------


def test_group_detail_member_list_includes_pending_and_active_with_status(
    client: TestClient,
) -> None:
    alice_id, alice_token, _ = _new_user(client)
    bob_id, bob_token, _ = _new_user(client)
    carol_id, _, _ = _new_user(client)
    group_id = _create_group(client, alice_token)

    _invite(client, alice_token, group_id, bob_id)
    _accept(client, bob_token, group_id)  # bob ACTIVE
    _invite(client, alice_token, group_id, carol_id)  # carol PENDING

    # As an ACTIVE member, alice sees both bob (ACTIVE) and carol (PENDING).
    detail = client.get(f"/api/groups/{group_id}", headers=_auth(alice_token))
    assert detail.status_code == 200
    members_by_id = {m["user_id"]: m for m in detail.json()["members"]}
    assert set(members_by_id) == {alice_id, bob_id, carol_id}
    assert members_by_id[alice_id]["status"] == "ACTIVE"
    assert members_by_id[bob_id]["status"] == "ACTIVE"
    assert members_by_id[carol_id]["status"] == "PENDING"


# --- GET /api/groups excludes PENDING-only groups (§7.1) ---------------


def test_group_list_excludes_a_group_where_the_caller_is_only_pending(
    client: TestClient,
) -> None:
    _, owner_token, _ = _new_user(client)
    bob_id, bob_token, _ = _new_user(client)
    group_id = _create_group(client, owner_token, name="Owner's group")
    _invite(client, owner_token, group_id, bob_id)

    assert client.get("/api/groups", headers=_auth(bob_token)).json() == []

    _accept(client, bob_token, group_id)
    names = [g["name"] for g in client.get("/api/groups", headers=_auth(bob_token)).json()]
    assert names == ["Owner's group"]
