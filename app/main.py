"""FastAPI application entrypoint."""

from fastapi import FastAPI, HTTPException, Request, status
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

from app.routers import auth, groups, users

app = FastAPI(title="Expense Splitting API")

app.include_router(auth.router)
app.include_router(users.router)
app.include_router(groups.router)


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


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}
