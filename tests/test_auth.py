"""Auth integration tests (docs/SPEC.md §7, §10.2, §10.4)."""

import uuid

import jwt
from fastapi.testclient import TestClient

from app.config import settings


def _register(client: TestClient, **overrides: str) -> dict[str, str]:
    payload = {
        "email": f"{uuid.uuid4()}@example.com",
        "password": "correct-horse-battery-staple",
        "name": "Test User",
        **overrides,
    }
    resp = client.post("/api/auth/register", json=payload)
    assert resp.status_code == 201, resp.text
    return payload


def test_register_success(client: TestClient) -> None:
    payload = {
        "email": f"{uuid.uuid4()}@example.com",
        "password": "correct-horse-battery-staple",
        "name": "Alice",
    }
    resp = client.post("/api/auth/register", json=payload)

    assert resp.status_code == 201
    body = resp.json()
    assert body["email"] == payload["email"]
    assert body["name"] == "Alice"
    assert "id" in body
    assert "password_hash" not in body
    assert "password" not in body


def test_register_duplicate_email_returns_409(client: TestClient) -> None:
    payload = _register(client)

    resp = client.post(
        "/api/auth/register",
        json={"email": payload["email"], "password": "another-password!", "name": "Someone Else"},
    )

    assert resp.status_code == 409


def test_login_success_returns_token_containing_user_id(client: TestClient) -> None:
    payload = _register(client)

    login_resp = client.post(
        "/api/auth/login", json={"email": payload["email"], "password": payload["password"]}
    )
    assert login_resp.status_code == 200
    token = login_resp.json()["access_token"]
    assert login_resp.json()["token_type"] == "bearer"

    decoded = jwt.decode(token, settings.jwt_secret, algorithms=[settings.jwt_algorithm])
    assert "sub" in decoded
    user_id = uuid.UUID(decoded["sub"])

    # Cross-check the id the token decodes to is really that user's id, by
    # asking /me (which independently decodes the same token) who it belongs to.
    me_resp = client.get("/api/users/me", headers={"Authorization": f"Bearer {token}"})
    assert me_resp.status_code == 200
    assert me_resp.json()["id"] == str(user_id)


def test_login_unknown_email_returns_401(client: TestClient) -> None:
    resp = client.post(
        "/api/auth/login",
        json={"email": f"{uuid.uuid4()}@example.com", "password": "whatever-it-is"},
    )
    assert resp.status_code == 401


def test_login_wrong_password_returns_401(client: TestClient) -> None:
    payload = _register(client)

    resp = client.post(
        "/api/auth/login", json={"email": payload["email"], "password": "definitely-not-it"}
    )
    assert resp.status_code == 401


def test_login_error_messages_are_byte_for_byte_identical(client: TestClient) -> None:
    """§10.4: "email not found" and "wrong password" must be indistinguishable."""
    payload = _register(client)

    unknown_email_resp = client.post(
        "/api/auth/login",
        json={"email": f"{uuid.uuid4()}@example.com", "password": "whatever-it-is"},
    )
    wrong_password_resp = client.post(
        "/api/auth/login", json={"email": payload["email"], "password": "definitely-not-it"}
    )

    assert unknown_email_resp.status_code == 401
    assert wrong_password_resp.status_code == 401
    assert unknown_email_resp.json()["detail"] == wrong_password_resp.json()["detail"]
    # Compare the raw response bytes too, not just the parsed field.
    assert unknown_email_resp.content == wrong_password_resp.content


def test_me_without_token_returns_401(client: TestClient) -> None:
    resp = client.get("/api/users/me")
    assert resp.status_code == 401


def test_me_with_forged_token_returns_401(client: TestClient) -> None:
    forged = jwt.encode(
        {"sub": str(uuid.uuid4())}, "not-the-real-secret", algorithm=settings.jwt_algorithm
    )
    resp = client.get("/api/users/me", headers={"Authorization": f"Bearer {forged}"})
    assert resp.status_code == 401
