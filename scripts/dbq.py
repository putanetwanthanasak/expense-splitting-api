"""Ad-hoc database query runner for manual verification.

Not part of the application - this exists so the definition-of-done checks in the
execution plan can be run on Windows without the psql client installed.

Usage (from the repo root):
    uv run --with "psycopg[binary]" python scripts/dbq.py "select 1"
    uv run --with "psycopg[binary]" python scripts/dbq.py "select 1" TEST_DATABASE_URL

Reads the connection string from .env. Defaults to DATABASE_URL; pass a second
argument to use a different key.
"""

import pathlib
import sys

import psycopg


def load_env(path: str = ".env") -> dict[str, str]:
    env: dict[str, str] = {}
    file = pathlib.Path(path)
    if not file.exists():
        sys.exit(f"error: {path} not found. Run this from the repo root.")
    for raw in file.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        env[key.strip()] = value.strip().strip('"').strip("'")
    return env


def main() -> None:
    if len(sys.argv) < 2:
        sys.exit(__doc__)

    sql = sys.argv[1]
    key = sys.argv[2] if len(sys.argv) > 2 else "DATABASE_URL"

    env = load_env()
    if key not in env:
        sys.exit(f"error: {key} is not set in .env (found: {', '.join(env) or 'nothing'})")

    with psycopg.connect(env[key]) as conn:
        cur = conn.execute(sql)
        if cur.description is None:
            print(f"OK - {cur.rowcount} row(s) affected")
            return
        headers = [c.name for c in cur.description]
        rows = cur.fetchall()
        print(" | ".join(headers))
        print("-" * (sum(len(h) for h in headers) + 3 * len(headers)))
        for row in rows:
            print(" | ".join("NULL" if v is None else str(v) for v in row))
        print(f"\n({len(rows)} row(s))")


if __name__ == "__main__":
    main()
