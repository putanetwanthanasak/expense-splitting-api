"""POST /api/auth/register, POST /api/auth/login."""

from fastapi import APIRouter, HTTPException, status

from app.dependencies import DbSession
from app.models.user import User
from app.schemas.auth import LoginRequest, RegisterRequest, TokenResponse
from app.schemas.user import UserOut
from app.services.auth import (
    EmailAlreadyRegisteredError,
    InvalidCredentialsError,
    authenticate_user,
    register_user,
)
from app.services.security import create_access_token

router = APIRouter(prefix="/api/auth", tags=["auth"])


@router.post(
    "/register",
    response_model=UserOut,
    status_code=status.HTTP_201_CREATED,
    summary="Register a new user",
)
def register(payload: RegisterRequest, db: DbSession) -> User:
    """Create an account. No roles or permissions -- every registered user is
    equal (§7).
    """
    try:
        return register_user(db, email=payload.email, password=payload.password, name=payload.name)
    except EmailAlreadyRegisteredError as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, "Email is already registered") from exc


@router.post("/login", response_model=TokenResponse, summary="Log in")
def login(payload: LoginRequest, db: DbSession) -> TokenResponse:
    """Exchange an email + password for a JWT access token.

    §10.4: an unknown email and a wrong password return byte-for-byte
    identical error responses, so a caller can never tell which one it was.
    """
    try:
        user = authenticate_user(db, email=payload.email, password=payload.password)
    except InvalidCredentialsError as exc:
        # str(exc) is always INVALID_CREDENTIALS_MESSAGE — identical for an
        # unknown email and a wrong password (§10.4).
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, str(exc)) from exc

    return TokenResponse(access_token=create_access_token(user.id))
