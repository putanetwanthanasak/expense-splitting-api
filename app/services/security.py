"""Password hashing and JWT helpers.

No SQLAlchemy or FastAPI imports needed here — this is plain crypto/token logic
that only touches app.config for secrets, so it's easy to reason about in
isolation.
"""

import uuid
from datetime import UTC, datetime, timedelta

import jwt
from passlib.context import CryptContext

from app.config import settings

_pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


def hash_password(password: str) -> str:
    """Hash a plaintext password. Never store plaintext anywhere (§7 rule 1)."""
    return str(_pwd_context.hash(password))


def verify_password(password: str, password_hash: str) -> bool:
    return bool(_pwd_context.verify(password, password_hash))


def create_access_token(user_id: uuid.UUID) -> str:
    expires_at = datetime.now(UTC) + timedelta(minutes=settings.access_token_expire_minutes)
    payload = {"sub": str(user_id), "exp": expires_at}
    return jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm)


class InvalidTokenError(Exception):
    """Raised for any unusable token: missing signature, malformed, or expired.

    Deliberately a single exception type for every failure mode — the caller
    (app.dependencies.get_current_user) turns all of them into the same generic
    401, the same way §10.4 asks for one message covering "unknown email" and
    "wrong password". Distinguishing "expired" from "tampered" in the response
    would just hand an attacker a free oracle.
    """


def decode_access_token(token: str) -> uuid.UUID:
    """Decode and validate a JWT, returning the user id it was issued for.

    Raises InvalidTokenError on any problem: bad signature, expired, malformed,
    or a payload that doesn't carry a valid UUID `sub` claim.
    """
    try:
        payload = jwt.decode(token, settings.jwt_secret, algorithms=[settings.jwt_algorithm])
        return uuid.UUID(payload["sub"])
    except (jwt.PyJWTError, KeyError, ValueError) as exc:
        raise InvalidTokenError from exc
