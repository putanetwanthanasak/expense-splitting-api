"""GET /api/users/me."""

from fastapi import APIRouter

from app.dependencies import CurrentUser
from app.models.user import User
from app.schemas.user import UserOut

router = APIRouter(prefix="/api/users", tags=["users"])


@router.get("/me", response_model=UserOut, summary="Get the current user")
def get_me(current_user: CurrentUser) -> User:
    """Resolve the caller's own profile from their bearer token."""
    return current_user
