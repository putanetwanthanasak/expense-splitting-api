"""FastAPI dependencies shared across routers."""

from typing import Annotated

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.user import User
from app.services.security import InvalidTokenError, decode_access_token

DbSession = Annotated[Session, Depends(get_db)]

# auto_error=False: FastAPI's HTTPBearer raises 403 by default when the
# Authorization header is missing. That conflates "not authenticated" with
# "authenticated but not permitted" (§10.2) — a missing token must be 401, so we
# disable the built-in auto-error and raise 401 ourselves below.
_bearer_scheme = HTTPBearer(auto_error=False)

# One generic message for every way a token can be unusable — missing, expired,
# malformed, or signed with the wrong key — for the same reason §10.4 asks for a
# single login-failure message: telling the caller *which* thing was wrong about
# their token is a gift to an attacker, not a UX nicety.
_INVALID_TOKEN_MESSAGE = "Could not validate credentials"


def get_current_user(
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(_bearer_scheme)],
    db: DbSession,
) -> User:
    """Resolve the caller's User from the Authorization: Bearer <token> header.

    Always 401 on failure (missing, expired, malformed, or forged token; a token
    for a user that no longer exists) — never 403. This dependency only answers
    "who are you"; whether that user is *allowed* to do something is a 403
    decision made by the endpoint/route dependency that needs `group_id` (§8.5),
    not here.
    """
    if credentials is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, _INVALID_TOKEN_MESSAGE)

    try:
        user_id = decode_access_token(credentials.credentials)
    except InvalidTokenError as exc:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, _INVALID_TOKEN_MESSAGE) from exc

    user = db.get(User, user_id)
    if user is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, _INVALID_TOKEN_MESSAGE)

    return user


CurrentUser = Annotated[User, Depends(get_current_user)]
