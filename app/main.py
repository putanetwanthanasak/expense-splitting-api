"""FastAPI application entrypoint."""

from fastapi import FastAPI, HTTPException, Request, status
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

from app.routers import auth, expenses, groups, me, settlements, users

app = FastAPI(
    title="Expense Splitting API",
    description=(
        "A group expense-sharing API (Splitwise-style). Members record expenses "
        "paid on each other's behalf; the API computes who owes whom and "
        "proposes a reduced set of repayments. See docs/SPEC.md in the repo "
        "for the full specification."
    ),
    version="0.1.0",
)

app.include_router(auth.router)
app.include_router(users.router)
app.include_router(me.router)
app.include_router(groups.router)
app.include_router(expenses.router)
app.include_router(settlements.router)


# Centralized error handling (§10.6): every route's error goes through one of
# these two handlers, so every error response has the same `{"detail": ...}`
# shape. Individual routes raise HTTPException (or let Pydantic validation fail)
# and never construct their own error JSONResponse.
@app.exception_handler(HTTPException)
async def http_exception_handler(request: Request, exc: HTTPException) -> JSONResponse:
    return JSONResponse(status_code=exc.status_code, content={"detail": exc.detail})


@app.exception_handler(RequestValidationError)
async def validation_exception_handler(
    request: Request, exc: RequestValidationError
) -> JSONResponse:
    return JSONResponse(
        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
        content={"detail": jsonable_encoder(exc.errors())},
    )


@app.get("/health", summary="Health check", tags=["health"])
def health() -> dict[str, str]:
    """Liveness probe. No authentication required."""
    return {"status": "ok"}
