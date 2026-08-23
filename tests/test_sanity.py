"""CI sanity checks (docs/SPEC.md §10.8).

A pipeline that stays green while verifying nothing is worse than no pipeline —
these two tests exist so CI is actually exercising the app and the database it's
supposed to be testing against, not just running an empty test collection.
"""

from fastapi.testclient import TestClient
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.main import app


def test_health_endpoint_returns_200() -> None:
    client = TestClient(app)
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_database_connection_works(db_session: Session) -> None:
    """A real query against TEST_DATABASE_URL, proving the CI Postgres service
    container is actually reachable and usable, not just declared in the workflow.
    """
    result = db_session.execute(text("SELECT 1")).scalar_one()
    assert result == 1
