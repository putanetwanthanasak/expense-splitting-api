"""GET /api/users/me."""

from fastapi import APIRouter

from app.dependencies import CurrentUser
from app.models.user import User
from app.schemas.user import UserOut

router = APIRouter(prefix="/api/users", tags=["users"])


@router.get("/me", response_model=UserOut)
def get_me(current_user: CurrentUser) -> User:
    return current_user
