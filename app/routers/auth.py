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


@router.post("/register", response_model=UserOut, status_code=status.HTTP_201_CREATED)
def register(payload: RegisterRequest, db: DbSession) -> User:
    try:
        return register_user(db, email=payload.email, password=payload.password, name=payload.name)
    except EmailAlreadyRegisteredError as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, "Email is already registered") from exc


@router.post("/login", response_model=TokenResponse)
def login(payload: LoginRequest, db: DbSession) -> TokenResponse:
    try:
        user = authenticate_user(db, email=payload.email, password=payload.password)
    except InvalidCredentialsError as exc:
        # str(exc) is always INVALID_CREDENTIALS_MESSAGE — identical for an
        # unknown email and a wrong password (§10.4).
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, str(exc)) from exc

    return TokenResponse(access_token=create_access_token(user.id))
