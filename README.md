# Expense Splitting API

A group expense-sharing backend, Splitwise-style.
Members log who paid for what, and the API works out who owes whom, down to the cent.
It also proposes a short list of repayments to settle up — but a "settlement" here is only a record that a repayment happened offline, never a real payment.

The full specification lives in [`docs/SPEC.md`](docs/SPEC.md); the
non-negotiable invariants are also summarized in [`CLAUDE.md`](CLAUDE.md).

## Stack

| Layer | Choice | Why |
|---|---|---|
| Language | Python 3.12+ | modern typing, used throughout for correctness |
| Framework | FastAPI | type hints double as request validation and generate the OpenAPI docs for free |
| ORM | SQLAlchemy 2.0, sync | this project is about correctness, not throughput — async adds session/greenlet complexity this scale doesn't need |
| Migrations | Alembic | schema changes are reviewable, ordered, and reversible |
| Validation | Pydantic v2 | validate once at the API boundary; trust the data everywhere past that |
| Database | PostgreSQL | real `NUMERIC` and transaction support, both load-bearing for money math |
| Auth | PyJWT + passlib[bcrypt] | stateless bearer tokens, industry-standard password hashing |
| Tests | pytest + httpx + hypothesis | httpx drives the API like a real client; hypothesis property-tests the money math against thousands of random inputs |
| Lint / types | ruff + mypy | fast, and mypy runs in strict mode |

A React/TypeScript frontend is specified in `docs/SPEC.md` §14 but isn't part
of this repository yet — everything here is the backend.

## Technical highlights

### Splitting money without losing a cent

`100 / 3 = 33.333...`. Round every share to `33.33` and three of them sum to
`99.99` — a cent has vanished, and a group's balances stop summing to zero.

The fix is the largest remainder method: round every share *down* to the
cent, then hand out the leftover cents one at a time, in a fixed order, until
the shares sum back to the original total exactly.

```python
def split_equally(total: Decimal, user_ids: list[UUID]) -> dict[UUID, Decimal]:
    cent = Decimal("0.01")
    base = (total / len(user_ids)).quantize(cent, rounding=ROUND_DOWN)
    shares = {uid: base for uid in user_ids}

    remainder = total - base * len(user_ids)          # e.g. 100.00 - 99.99 = 0.01
    extra_cents = int(remainder / cent)                # e.g. 1
    for uid in user_ids[:extra_cents]:                 # always this same order
        shares[uid] += cent

    assert sum(shares.values(), start=Decimal("0.00")) == total  # never merely hoped for
    return shares
```

Splitting `100.00` three ways gives `33.34, 33.33, 33.33` — summing to
exactly `100.00`. Every split type (`EQUAL`, `EXACT`, `PERCENTAGE`,
`SHARES`) goes through the same remainder-distribution logic in
`app/services/splitting.py`, which is asserted against real data in
`app/services/expenses.py` before any transaction commits, and property-tested
against thousands of random totals and participant counts in
`tests/test_split_calculation.py`.

### Debt simplification

Settling every pairwise debt directly produces more transfers than
necessary — a three-person cycle where everyone owes everyone else 100 nets
out to zero transfers, not three. `app/services/simplify.py` reduces a
group's net balances to a short transfer list with a greedy algorithm: repeatedly
match the largest creditor against the largest debtor (two max-heaps, via
`heapq`), transfer as much as satisfies the smaller side, and repeat.

- **Complexity:** O(n log n).
- **Transfer count:** at most N−1 for N members with a nonzero balance —
  each step fully settles at least one side and removes it from its heap.
- **What it doesn't do:** find the fewest possible transfers. That's a
  different, much harder problem — it requires finding subsets of balances
  that sum to zero so they can settle internally, which reduces from
  subset-sum/partition and is NP-hard. This repo implements the greedy
  version and says so plainly everywhere the result is shown, rather than
  overselling what it computed.

### The invariant that catches almost everything

The core correctness property of this whole system: **a group's net
balances always sum to exactly zero.** If they don't, money was created or
destroyed somewhere — the worst class of bug a financial system can have.

Rather than trust every test author to remember to check this,
`tests/conftest.py` has an `autouse=True` fixture that runs after *every
single test in the suite*, walks every group in the database, and asserts
`sum(net_balance) == Decimal("0.00")` for each one. This turns the entire
test suite into a fleet of invariant checks for free, and it's how most
rounding and split-calculation bugs during development got caught before
they became balances that didn't add up.

## Design decisions

### Why there's no `balances` table

Balances are recomputed from expenses and settlements on every read — there
is deliberately no stored `balances` table, and no cached balance column
anywhere.

A stored balance is a race condition waiting to happen: two concurrent
expense inserts both read the same starting balance, both compute their own
new total, and both write it back — one of those writes silently overwrites
the other, and nobody ever finds out. Live computation has no stored state
to corrupt in the first place. It's slower at scale, and for this project
that trade is the right one. If caching ever becomes necessary, the fix is a
materialized view or a guarded write with a version column — never a naive
`UPDATE ... SET amount = amount + ?`.

## Running it

Requires Python 3.12+, [`uv`](https://docs.astral.sh/uv/), and a local
PostgreSQL server.

```bash
uv sync --locked
cp .env.example .env                                    # then fill in real values
createdb expense_splitting && createdb expense_splitting_test
uv run alembic upgrade head
uv run uvicorn app.main:app --reload
```

The API is now at `http://localhost:8000`, with interactive docs at
`http://localhost:8000/docs`.

### Running the tests

```bash
uv run pytest
```

Tests run against `TEST_DATABASE_URL`, never `DATABASE_URL` — the suite
refuses to start if that database's name doesn't contain `test`, as the last
line of defense against a typo truncating the dev database.

## Example: settling up a group

```
GET /api/groups/{id}/settle-up
Authorization: Bearer <token>
```

```json
{
  "transfers": [
    { "from_user_id": "uuid2", "to_user_id": "uuid1", "amount": "100.00" },
    { "from_user_id": "uuid3", "to_user_id": "uuid1", "amount": "50.00" }
  ],
  "note": "..."
}
```

`transfers` is the reduced repayment list described above. The response also
carries a `note` field, in plain language, restating the same guarantee this
README does: at most N−1 transfers, with no claim about whether a shorter
list exists.
