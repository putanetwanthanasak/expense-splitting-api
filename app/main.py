"""FastAPI application entrypoint.

Phase 1 scaffold: only /health is wired up. Endpoints are added in later phases.
"""

from fastapi import FastAPI

app = FastAPI(title="Expense Splitting API")


@app.get("/health")
def health() -> dict[str, str]:
    # TEMPORARY: deliberately broken to prove CI actually goes red (SPEC.md §10.8).
    # This commit is reverted immediately after CI confirms the failure.
    raise RuntimeError("intentionally broken for CI verification")
