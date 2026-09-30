#!/bin/sh
# Container entrypoint for the backend image: bring the schema up to date on
# every start, then hand PID 1 to the server (CMD) so it receives signals.
set -e

alembic upgrade head

exec "$@"
