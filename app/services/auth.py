"""Registration and login business logic.

Deliberately independent of FastAPI: these functions raise plain domain
exceptions (EmailAlreadyRegisteredError, InvalidCredentialsError) rather than
HTTPException, so the router owns the mapping to HTTP status codes and this
module stays testable without spinning up the web layer.
"""

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models.user import User
from app.services.security import hash_password, verify_password

# §10.4: "email not found" and "wrong password" must produce byte-for-byte
# identical responses, to prevent user enumeration. Using one shared constant
# instead of two call sites that happen to write the same string is what
# actually guarantees that — a future edit to one message can't silently
# diverge from the other.
INVALID_CREDENTIALS_MESSAGE = "Incorrect email or password"

# A precomputed hash of a password nobody will ever type, used only so that a
# "no such user" lookup still pays the same bcrypt cost as a real password
# check. Without this, a login attempt against an unknown email returns faster
# than one against a real email with a wrong password — a timing side channel
# that leaks exactly what the identical error message is trying to hide.
_DUMMY_PASSWORD_HASH = hash_password("not-a-real-password-used-only-for-timing-safety")


class EmailAlreadyRegisteredError(Exception):
    """Raised when registering an email that already has an account."""


class InvalidCredentialsError(Exception):
    """Raised for any login failure. Always carries INVALID_CREDENTIALS_MESSAGE —
    see the module docstring on why there is only ever one message.
    """

    def __init__(self) -> None:
        super().__init__(INVALID_CREDENTIALS_MESSAGE)


def register_user(db: Session, *, email: str, password: str, name: str) -> User:
    """Create a new user. Raises EmailAlreadyRegisteredError on a duplicate email.

    Relies on the `users.email` UNIQUE constraint rather than a pre-check — a
    check-then-insert has a race window under concurrency (§10.9); catching the
    constraint violation does not.
    """
    user = User(email=email, password_hash=hash_password(password), name=name)
    db.add(user)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise EmailAlreadyRegisteredError from exc
    db.refresh(user)
    return user


def authenticate_user(db: Session, *, email: str, password: str) -> User:
    """Verify credentials. Raises InvalidCredentialsError if the email doesn't
    exist or the password is wrong — the caller cannot tell which happened.
    """
    user = db.query(User).filter(User.email == email).one_or_none()
    if user is None:
        verify_password(password, _DUMMY_PASSWORD_HASH)  # burn the same time
        raise InvalidCredentialsError
    if not verify_password(password, user.password_hash):
        raise InvalidCredentialsError
    return user
