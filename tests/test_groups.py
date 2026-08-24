"""Group management integration tests (docs/SPEC.md §7, §8.5, §9)."""

import uuid

from fastapi.testclient import TestClient


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


def _new_user(client: TestClient) -> tuple[str, str, str]:
    """Register + log in a fresh user. Returns (user_id, token, email)."""
    payload = _signup(client)
    token = _login(client, payload)
    me = client.get("/api/users/me", headers=_auth(token))
    assert me.status_code == 200
    return me.json()["id"], token, payload["email"]


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _create_group(client: TestClient, token: str, name: str = "Test Group") -> str:
    resp = client.post("/api/groups", json={"name": name}, headers=_auth(token))
    assert resp.status_code == 201, resp.text
    group_id: str = resp.json()["id"]
    return group_id


def test_creating_group_makes_creator_a_member_immediately(client: TestClient) -> None:
    user_id, token, _ = _new_user(client)

    group_id = _create_group(client, token, "Trip to Japan")

    detail = client.get(f"/api/groups/{group_id}", headers=_auth(token))
    assert detail.status_code == 200
    member_ids = {m["user_id"] for m in detail.json()["members"]}
    assert member_ids == {user_id}


def test_get_groups_shows_only_the_callers_groups(client: TestClient) -> None:
    _, alice_token, _ = _new_user(client)
    _, bob_token, _ = _new_user(client)

    _create_group(client, alice_token, "Alice's group")
    _create_group(client, bob_token, "Bob's group")

    resp = client.get("/api/groups", headers=_auth(alice_token))
    assert resp.status_code == 200
    names = {g["name"] for g in resp.json()}
    assert names == {"Alice's group"}


def test_non_member_get_group_detail_returns_403_not_404(client: TestClient) -> None:
    _, owner_token, _ = _new_user(client)
    _, outsider_token, _ = _new_user(client)

    group_id = _create_group(client, owner_token, "Private")

    resp = client.get(f"/api/groups/{group_id}", headers=_auth(outsider_token))
    assert resp.status_code == 403


def test_non_member_add_member_returns_403(client: TestClient) -> None:
    _, owner_token, _ = _new_user(client)
    _, outsider_token, _ = _new_user(client)
    third_id, _, _ = _new_user(client)

    group_id = _create_group(client, owner_token, "Private")

    resp = client.post(
        f"/api/groups/{group_id}/members",
        json={"user_id": third_id},
        headers=_auth(outsider_token),
    )
    assert resp.status_code == 403


def test_no_token_returns_401_and_non_member_returns_403(client: TestClient) -> None:
    """Written as a pair (per the phase spec) to prove 401 and 403 are actually
    distinguished (§10.2): no token at all is "not authenticated" -> 401; a real
    token belonging to someone who isn't a member is "authenticated but not
    permitted" -> 403.
    """
    _, owner_token, _ = _new_user(client)
    _, outsider_token, _ = _new_user(client)

    group_id = _create_group(client, owner_token, "Private")

    no_token_resp = client.get(f"/api/groups/{group_id}")
    assert no_token_resp.status_code == 401

    non_member_resp = client.get(f"/api/groups/{group_id}", headers=_auth(outsider_token))
    assert non_member_resp.status_code == 403


def test_adding_duplicate_member_returns_409(client: TestClient) -> None:
    _, owner_token, _ = _new_user(client)
    new_member_id, _, _ = _new_user(client)

    group_id = _create_group(client, owner_token, "Trip")

    first = client.post(
        f"/api/groups/{group_id}/members",
        json={"user_id": new_member_id},
        headers=_auth(owner_token),
    )
    assert first.status_code == 201, first.text

    dup = client.post(
        f"/api/groups/{group_id}/members",
        json={"user_id": new_member_id},
        headers=_auth(owner_token),
    )
    assert dup.status_code == 409


def test_adding_nonexistent_user_returns_404(client: TestClient) -> None:
    _, owner_token, _ = _new_user(client)
    group_id = _create_group(client, owner_token, "Trip")

    resp = client.post(
        f"/api/groups/{group_id}/members",
        json={"user_id": str(uuid.uuid4())},
        headers=_auth(owner_token),
    )
    assert resp.status_code == 404


def test_removing_last_member_leaves_group_empty_but_not_deleted(client: TestClient) -> None:
    """CLAUDE.md: "Removing the last member never deletes the group."""
    user_id, token, _ = _new_user(client)
    group_id = _create_group(client, token, "Solo trip")

    resp = client.delete(f"/api/groups/{group_id}/members/{user_id}", headers=_auth(token))
    assert resp.status_code == 204

    # The (now former) member can no longer reach the group's detail endpoint —
    # they're not a member any more, so require_group_member correctly 403s them
    # rather than the group having vanished (which would 404 or 500).
    detail = client.get(f"/api/groups/{group_id}", headers=_auth(token))
    assert detail.status_code == 403


def test_removing_a_non_member_returns_404(client: TestClient) -> None:
    _, owner_token, _ = _new_user(client)
    outsider_id, _, _ = _new_user(client)
    group_id = _create_group(client, owner_token, "Trip")

    resp = client.delete(
        f"/api/groups/{group_id}/members/{outsider_id}", headers=_auth(owner_token)
    )
    assert resp.status_code == 404
