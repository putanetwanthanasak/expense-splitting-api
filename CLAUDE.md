# CLAUDE.md

Guidance for Claude Code (and any other contributor, human or otherwise) working in
this repository. `docs/SPEC.md` is the authoritative spec — this file exists so the
non-negotiable invariants are visible from day one, not retrofitted after a bug
proves they were needed.

## What this project is

A group expense-sharing API (Splitwise-style): FastAPI (sync SQLAlchemy 2.0) +
PostgreSQL backend, React/TypeScript frontend. See `docs/SPEC.md` for the full
spec — section numbers there are stable and cited throughout this file and the
codebase.

The two hard problems are rounding money without losing cents (§6) and debt
simplification (§5). Everything else is ordinary CRUD.

## Invariants (docs/SPEC.md §8)

These must hold **at all times**. Every one of them has caused a real bug in a
previous version of a system like this — that's why each is called out explicitly
instead of trusted to "obviously" fall out of correct code.

### 8.1 Net balances within a group sum to exactly 0

Enforce this as a mechanism, not a habit: a pytest fixture with `autouse=True` that
runs after **every** test, walks every group in the database, and asserts
`sum(net_balance) == Decimal("0.00")`. This turns every test in the suite into an
invariant test and catches almost every class of bug in this system, rounding
errors included. (See `tests/conftest.py::_assert_balances_sum_to_zero`.)

### 8.2 Expense splits sum to the expense amount exactly

Assert this in application code before committing the transaction — not only in
tests. On mismatch, roll back.

### 8.3 Money is Decimal everywhere, never float

- Python: `decimal.Decimal`
- SQLAlchemy: `Numeric(12, 2)`
- Pydantic: `condecimal(max_digits=12, decimal_places=2)`
- **Never convert to float at any point, not even once, not even in a log line.**

### 8.4 Balances are computed live, never cached

There is deliberately no `balances` table. A stored balance column would reproduce
the classic lost-update race: two concurrent expense inserts both read the old
balance and write back conflicting totals, and nobody ever finds out. Live
computation has no state to corrupt — it's slower at scale, and that trade is
correct here. If caching ever becomes necessary, it needs a materialized view or a
guarded write with a version column — never a naive `UPDATE ... SET amount = amount + ?`.

### 8.5 Group-level authorization on every group-scoped endpoint

Authentication middleware only establishes *who you are*. Verifying *whether you
belong to this group* must happen in the handler, or in a dependency that receives
`group_id`. Non-members get **403** — not 404, not 401.

"Member" means an **ACTIVE** member (SPEC §7.1). A `group_members` row is
`PENDING` until the invitee accepts; a PENDING member is treated exactly like a
stranger — 403 everywhere, absent from `/balances`, `/settle-up`, the group's
member list, and `GET /api/groups` — with `accept`/`decline` as their only
permitted actions. Every membership query that gates access or feeds a balance
must filter `status == ACTIVE`.

### 8.6 Expense participants must belong to the group

A non-member listed as a participant is a 400 — and a PENDING member is not a
member (§8.5), so their id here is the same 400.

### 8.7 A settlement's payer and recipient must differ

Enforced by a database CHECK constraint and validated in Pydantic.

### 8.8 Remainder distribution is deterministic

Always a fixed, reproducible order. No sets, no unordered dict iteration.

## Two extra rules

### `app/services/splitting.py` and `app/services/simplify.py` must stay pure modules

Neither may import SQLAlchemy or FastAPI, ever. `splitting.py` computes splits
(§6) and `simplify.py` computes the debt-simplification transfer list (§5) — both
take plain Python values (`Decimal`s and IDs) in and return plain Python values
out. This keeps that logic testable as pure logic — including the hypothesis
property tests in `tests/test_split_calculation.py` and
`tests/test_debt_simplification.py` — with no database or web framework in the
loop, and keeps it usable from a script, a different endpoint, or a future async
path without dragging a sync `Session` along.

### Removing the last member never deletes the group

When the last member leaves a group, let the group become empty. **Never
auto-delete the group** — deleting it would destroy expense history, which
contradicts the rule that removing a member must keep their expense history intact
(§9, "Group membership"). An empty group with historical expenses is a valid,
permanent state.

## Project layout

```
app/
  main.py           FastAPI app + route registration
  config.py         pydantic-settings, loads .env
  database.py       SQLAlchemy engine + SessionLocal (sync)
  models/           ORM models, one file per entity
  schemas/          Pydantic v2 request/response schemas
  services/         business logic (splitting, balances, debt simplification, auth)
  routers/          FastAPI routers
tests/
  conftest.py       TEST_DATABASE_URL fixtures, per-test rollback, §8.1 autouse check
alembic/            migrations
```

## Working conventions

- **Sync SQLAlchemy, not async.** FastAPI runs sync endpoints in a threadpool
  automatically; async SQLAlchemy adds session-management and greenlet complexity
  for no benefit at this scale (§2).
- **Tests never run against the dev database.** `tests/conftest.py` refuses to
  start if `TEST_DATABASE_URL`'s database name doesn't contain `test` (§10.7).
- **Branch per feature, PRs only** — never push directly to `main` (§10.10). Never
  commit `.env`; if one is ever committed, adding it to `.gitignore` afterwards does
  not remove it from history.
- **401 vs 403** (§10.2): 401 = not authenticated, 403 = authenticated but not
  permitted. The login/register endpoints are exempt from any global 401 interceptor
  on the frontend (§10.3).
- **Login failures are indistinguishable** (§10.4): "email not found" and "wrong
  password" must return byte-for-byte identical responses.
- **Never say "minimum" or "optimal" about debt simplification** (§5) in API docs,
  README, or any user-facing string — the greedy algorithm guarantees at most N−1
  transfers but is not a proven minimum (that's NP-hard). Use "simplified" or
  "reduced".
- **A check is not a lock** (§10.9): rely on DB constraints (`UNIQUE`, `CHECK`) for
  concurrency safety, not a preceding `if`.
- **A business rule that must return 400, enforced in Pydantic:** a plain
  `ValueError` from a `model_validator` becomes a 422 (FastAPI's normal request-body
  validation path), which is wrong for a rule §9 specifies as 400. Raise
  `HTTPException(400, ...)` directly from the validator instead — Pydantic only
  intercepts `ValueError`/`TypeError`/`AssertionError`, so an `HTTPException`
  propagates unchanged to the app's existing `HTTPException` handler. See
  `app/schemas/settlement.py`'s payer/recipient check (§8.7) for the pattern; use it
  again rather than reinventing it for the next Pydantic-level rule that needs 400.
