"""FastAPI application entrypoint.

Phase 1 scaffold: only /health is wired up. Endpoints are added in later phases.
"""

from fastapi import FastAPI

app = FastAPI(title="Expense Splitting API")


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}
