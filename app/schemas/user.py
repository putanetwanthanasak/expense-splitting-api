"""User-facing response schemas."""

import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict


class UserOut(BaseModel):
    """A user as returned to clients. No password_hash field — ever (§7)."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    email: str
    name: str
    created_at: datetime


class UserLookupOut(BaseModel):
    """GET /api/users/lookup?email=… — just enough to resolve an email to a
    user_id before inviting them (§7.1). Deliberately narrower than UserOut:
    no created_at, nothing an authenticated stranger has no business seeing.
    """

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    email: str
    name: str
