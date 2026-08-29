"""GET /api/users/me, GET /api/users/lookup."""

from fastapi import APIRouter, HTTPException, Query, status

from app.dependencies import CurrentUser, DbSession
from app.models.user import User
from app.schemas.user import UserLookupOut, UserOut

router = APIRouter(prefix="/api/users", tags=["users"])


@router.get("/me", response_model=UserOut, summary="Get the current user")
def get_me(current_user: CurrentUser) -> User:
    """Resolve the caller's own profile from their bearer token."""
    return current_user


@router.get("/lookup", response_model=UserLookupOut, summary="Look up a user by email")
def lookup_user(
    current_user: CurrentUser,
    db: DbSession,
    email: str = Query(min_length=1),
) -> User:
    """Resolve an email address to a user (§7.1) so the frontend can turn "invite
    this email" into the `user_id` that POST /api/groups/{id}/members still
    expects. Requires authentication; 404 if no user has that email.

    Returns only id / email / name — never the full profile — because any
    authenticated user can call this for any address.
    """
    user = db.query(User).filter(User.email == email).one_or_none()
    if user is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No user with that email")
    return user
