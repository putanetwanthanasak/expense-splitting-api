# Expense Splitting API — Specification

A group expense-sharing service (Splitwise-style). Members record expenses paid on
each other's behalf; the system computes who owes whom and proposes a reduced set
of repayments.

This document is the authoritative reference. Section numbers are stable — other
documents and prompts cite them.

---

## 1. Overview

**In scope:** Backend API (Python/FastAPI) + frontend (React). Authentication,
group management, expense tracking with four split types, balance calculation,
debt simplification, settlement recording.

**Out of scope:** Real payment processing. A "settlement" is only a record that a
repayment happened offline.

**The two hard problems** — everything else is ordinary CRUD:

1. **Rounding money without losing cents** (§6). Splitting 100 three ways must not
   silently destroy 0.01.
2. **Debt simplification** (§5), including being precise about what the algorithm
   does and does not guarantee.

---

## 2. Stack

| Layer | Choice | Reason |
|---|---|---|
| Language | Python 3.12+ | |
| Framework | FastAPI | type hints, automatic OpenAPI docs |
| ORM | SQLAlchemy 2.0, **sync** | see note below |
| Migrations | Alembic | |
| Validation | Pydantic v2 | |
| Database | PostgreSQL | full transaction and NUMERIC support |
| Auth | PyJWT + passlib[bcrypt] | |
| Tests | pytest + httpx + hypothesis | |
| Lint / types | ruff + mypy | |
| Frontend | React + TypeScript + Vite | |

**Sync, not async.** FastAPI runs sync endpoints in a threadpool automatically.
Async SQLAlchemy adds session-management and greenlet complexity for no benefit at
this scale. This project is about correctness, not throughput. Using async would be
a separate, deliberate decision — not something to adopt because "FastAPI is async".

---

## 3. Data Model

```
User ──< GroupMember >── Group
                           │
                           ├──< Expense ──< ExpenseSplit >── User
                           │       │
                           │       └── paid_by ──> User
                           │
                           └──< Settlement ──> from_user, to_user
```

### `users`
| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | UUIDs everywhere, to avoid enumerable IDs |
| `email` | String, unique | |
| `password_hash` | String | never store plaintext |
| `name` | String | |
| `created_at` | DateTime | |

### `groups`
| Column | Type |
|---|---|
| `id` | UUID PK |
| `name` | String |
| `created_by_user_id` | UUID FK → users |
| `created_at` | DateTime |

### `group_members`
| Column | Type |
|---|---|
| `id` | UUID PK |
| `group_id` | UUID FK → groups |
| `user_id` | UUID FK → users |
| `joined_at` | DateTime |

Constraint: `UNIQUE (group_id, user_id)`
Indexes: `(group_id)`, `(user_id)`

### `expenses`
| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `group_id` | UUID FK → groups | |
| `paid_by_user_id` | UUID FK → users | who actually paid |
| `amount` | `Numeric(12, 2)` | **never Float** |
| `description` | String | |
| `expense_date` | Date | when it happened, not when it was recorded |
| `split_type` | Enum | `EQUAL` / `EXACT` / `PERCENTAGE` / `SHARES` |
| `created_at` | DateTime | |

Indexes: `(group_id)`, `(paid_by_user_id)`

### `expense_splits`
| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `expense_id` | UUID FK → expenses | |
| `user_id` | UUID FK → users | |
| `amount_owed` | `Numeric(12, 2)` | this participant's share |

Constraint: `UNIQUE (expense_id, user_id)`
Invariant: `SUM(amount_owed) == expense.amount` exactly (see §8.2)

### `settlements`
| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `group_id` | UUID FK → groups | |
| `from_user_id` | UUID FK → users | payer |
| `to_user_id` | UUID FK → users | recipient |
| `amount` | `Numeric(12, 2)` | |
| `settled_at` | DateTime | |

Constraint: `CHECK (from_user_id != to_user_id)`

### There is deliberately no `balances` table

Balances are recomputed from expenses + settlements on every read.

A stored balance column would reproduce the classic lost-update race: two concurrent
expense inserts both read the old balance and write back conflicting totals, and
nobody ever finds out. Live computation has no state to corrupt. It is slower at
scale; that trade is correct here.

**Put this reasoning in a code comment** so a future contributor does not "optimize"
it into a bug. If it ever must be cached, use a materialized view or a guarded write
with a version column — never a naive `UPDATE ... SET amount = amount + ?`.

---

## 4. Balance Calculation

```
net(u) = (sum of expenses u paid for)
       − (sum of splits u is responsible for)
       + (sum of settlements u paid to others)
       − (sum of settlements u received)
```

| Value | Meaning |
|---|---|
| `net > 0` | creditor — others owe u |
| `net < 0` | debtor — u owes others |
| `net = 0` | settled |

### Worked example

A pays 300 for dinner, split equally across A, B, C (100 each):

| | paid | owes | net |
|---|---|---|---|
| A | 300 | 100 | **+200** |
| B | 0 | 100 | **−100** |
| C | 0 | 100 | **−100** |

Then B repays A 100 (settlement: from=B, to=A, amount=100):

| | paid | owes | settled out | settled in | net |
|---|---|---|---|---|---|
| A | 300 | 100 | 0 | 100 | **+100** |
| B | 0 | 100 | 100 | 0 | **0** |
| C | 0 | 100 | 0 | 0 | **−100** |

### The core invariant

```
The net balances of all members of a group sum to exactly 0.
```

If they do not, money was created or destroyed — the worst class of bug in a
financial system. See §8.1 for how this is enforced.

---

## 5. Debt Simplification

### Problem

Settling every pairwise debt directly produces more transfers than necessary:

```
A owes B 100
B owes C 100
C owes A 100
```
Three transfers, when in fact everyone is already square — zero transfers needed.

### Approach: greedy matching

```python
def simplify_debts(balances: dict[UserId, Decimal]) -> list[Transfer]:
    creditors = [(u, b) for u, b in balances.items() if b > 0]   # max-heap by amount
    debtors   = [(u, -b) for u, b in balances.items() if b < 0]  # max-heap by amount
    transfers = []

    while creditors and debtors:
        creditor, credit = pop_max(creditors)
        debtor, debt     = pop_max(debtors)

        amount = min(credit, debt)
        transfers.append(Transfer(from=debtor, to=creditor, amount=amount))

        if credit - amount > 0: push(creditors, (creditor, credit - amount))
        if debt - amount > 0:   push(debtors, (debtor, debt - amount))

    return transfers
```

**Termination:** each iteration zeroes out at least one party (whichever side is
smaller) and removes it from its heap, so the loop runs at most N times.

**Correctness:** net balances sum to 0 (§4), so creditors and debtors are exhausted
simultaneously; nobody is left stranded.

**Complexity:** O(n log n).

**Transfer count:** at most **N−1** for N members with non-zero balances.

### This is a heuristic, not a minimum — say so explicitly

Greedy matching does **not** always produce the fewest possible transfers.
Computing the true minimum is **NP-hard**: it requires finding subsets whose
balances sum to zero so they can settle internally, which reduces from
subset-sum / partition.

Requirements:

- Implement the greedy version; it is fast and good enough in practice.
- The docstring must state that it guarantees at most N−1 transfers and is **not**
  a proven minimum, and that the minimum is NP-hard.
- **Never use the words "minimum" or "optimal"** in the API docs, the README, or
  any user-facing string. Use "simplified" or "reduced".

Accurately describing an algorithm's limits is the point, not a disclaimer to bury.

### Decimal matters here too

The loop tests `> 0` and `credit - amount > 0`. With floats, a residue like
`0.0000000001` would keep a party alive forever and the loop would not terminate.
`Decimal` compares against zero exactly, with no epsilon.

---

## 6. Rounding — the hardest part

### Problem

Splitting 100 three ways:

```
100 / 3 = 33.333...  →  33.33 each
33.33 × 3 = 99.99  ≠  100.00
```

0.01 has vanished. Left unhandled, group balances stop summing to zero and errors
accumulate silently.

### Solution: largest remainder method

```python
from decimal import Decimal, ROUND_DOWN

def split_equally(total: Decimal, user_ids: list[UUID]) -> dict[UUID, Decimal]:
    n = len(user_ids)
    cent = Decimal("0.01")

    # 1. round every share down
    base = (total / n).quantize(cent, rounding=ROUND_DOWN)
    shares = {uid: base for uid in user_ids}

    # 2. compute what is left over
    remainder = total - (base * n)          # e.g. 100 - 99.99 = 0.01
    extra_cents = int(remainder / cent)      # e.g. 1

    # 3. hand out the leftover cents in a deterministic order
    for i in range(extra_cents):
        shares[user_ids[i]] += cent

    assert sum(shares.values()) == total     # must always hold
    return shares
```

Result: `33.34, 33.33, 33.33` — sums to exactly `100.00`.

### Rules

1. **Shares must always sum to the total exactly.** Assert it, in application code.
2. **Distribution order must be deterministic** — follow the input order (or sort by
   user_id). Never randomize; never rely on a set or on unordered iteration.
   Recomputing the same split must give the same answer.
3. **Round down, then distribute the remainder.** `ROUND_HALF_UP` can overshoot the
   total, which is harder to correct.
4. **Same rule for every split type.** EQUAL, PERCENTAGE and SHARES all hit this.

### The four split types

| Type | Input | Validation |
|---|---|---|
| `EQUAL` | participant list | at least one participant |
| `EXACT` | an amount per person | **must sum to `amount` exactly** — no rounding involved |
| `PERCENTAGE` | a percentage per person | **must sum to exactly 100**, then compute and distribute the remainder |
| `SHARES` | a share count per person (e.g. 2:1:1) | every share > 0, then compute proportionally and distribute the remainder |

`EXACT` is the only type that needs no rounding — but a mismatched sum must be
rejected with 400, never silently adjusted.

---

## 7. API Endpoints

### Auth
```
POST   /api/auth/register       register (no roles; every user is equal)
POST   /api/auth/login          returns a JWT
GET    /api/users/me            current user
GET    /api/users/lookup?email= resolve an email to {id, email, name}; 404 if none (auth required)
```

### Groups
```
POST   /api/groups                             create (creator joins as ACTIVE)
GET    /api/groups                              groups the caller is an ACTIVE member of
GET    /api/groups/{id}                         details + ACTIVE members
POST   /api/groups/{id}/members                 invite a member — creates a PENDING row (§7.1)
DELETE /api/groups/{id}/members/{uid}           remove a member / revoke a pending invitation
POST   /api/groups/{id}/members/me/accept       accept your own invitation (PENDING -> ACTIVE)
POST   /api/groups/{id}/members/me/decline      decline your own invitation (deletes the row)
```

### Me
```
GET    /api/me/invitations      your own PENDING invitations: {group_id, group_name, invited_at}
```

### Expenses
```
POST   /api/groups/{id}/expenses         create
GET    /api/groups/{id}/expenses         list (paginated)
GET    /api/expenses/{id}                details + splits
PATCH  /api/expenses/{id}                update (recompute all splits)
DELETE /api/expenses/{id}                delete
```

Example request — `EQUAL`:
```json
{
  "amount": "300.00",
  "description": "Dinner",
  "expense_date": "2026-08-14",
  "paid_by_user_id": "uuid...",
  "split_type": "EQUAL",
  "participant_user_ids": ["uuid1", "uuid2", "uuid3"]
}
```

Example request — `EXACT`:
```json
{
  "amount": "300.00",
  "split_type": "EXACT",
  "splits": [
    { "user_id": "uuid1", "amount": "150.00" },
    { "user_id": "uuid2", "amount": "100.00" },
    { "user_id": "uuid3", "amount": "50.00" }
  ]
}
```

### Balances and settlements
```
GET    /api/groups/{id}/balances         net balance per member
GET    /api/groups/{id}/settle-up        simplified transfer list
POST   /api/groups/{id}/settlements      record a repayment
GET    /api/groups/{id}/settlements      repayment history
```

Response for `/settle-up`:
```json
{
  "transfers": [
    { "from_user_id": "uuid2", "to_user_id": "uuid1", "amount": "100.00" },
    { "from_user_id": "uuid3", "to_user_id": "uuid1", "amount": "50.00" }
  ],
  "note": "Simplified using greedy matching; guarantees at most N-1 transfers, not a proven minimum."
}
```

### 7.1 Group membership requires acceptance

A `group_members` row has a **status**: `PENDING` or `ACTIVE`.

- `POST /api/groups/{id}/members` creates a **PENDING** row — an invitation, not
  a membership. It still takes a `user_id` in the body (resolve an email to one
  with `GET /api/users/lookup`). A nonexistent `user_id` is a 400; a user already
  present in **any** status is a 409.
- The invitee sees their PENDING invitations at `GET /api/me/invitations` and
  acts on their **own** row only:
  - `POST /api/groups/{id}/members/me/accept` — flips it to ACTIVE. 404 if the
    caller has no PENDING row in that group (never invited, already ACTIVE, or
    already declined/removed).
  - `POST /api/groups/{id}/members/me/decline` — deletes it. Same 404 rule.
- When a group is created, the creator's row is **ACTIVE** from the start, never
  PENDING.

Only **ACTIVE** members count as members anywhere it matters:

- **Group-scoped authorization (§8.5):** a PENDING member gets **403** on every
  group-scoped endpoint — identical to a stranger, preserving group-id
  enumeration resistance. `accept`/`decline` are their only permitted actions.
- **Balances (§4) and settle-up (§5):** never include a PENDING member. A
  settlement naming one is a 400.
- **Expense participants and payer (§8.6):** a PENDING member's id is "not a
  member of this group" — a 400, same as any outsider.
- `GET /api/groups` lists only groups where the caller is ACTIVE; a
  PENDING-only group appears in `GET /api/me/invitations` instead.
- `DELETE /api/groups/{id}/members/{uid}` doubles as "revoke a pending
  invitation": removing a PENDING row always succeeds (its net balance is
  trivially 0). Removing an ACTIVE member is unchanged — 409 if their net ≠ 0.

Pre-existing rows (before this feature) are backfilled to ACTIVE: they were
implicitly accepted memberships.

---

## 8. Invariants

These must hold at all times. Copy them into `CLAUDE.md`.

### 8.1 Net balances within a group sum to exactly 0

Enforce this as a mechanism, not a habit: a pytest fixture with `autouse=True` that
runs after **every** test, walks every group in the database, and asserts
`sum(net_balance) == Decimal("0.00")`.

This turns every test in the suite into an invariant test and catches almost every
class of bug in this system, rounding errors included.

### 8.2 Expense splits sum to the expense amount exactly

Assert this in application code before committing the transaction — not only in
tests. On mismatch, roll back.

### 8.3 Money is Decimal everywhere, never float

- Python: `decimal.Decimal`
- SQLAlchemy: `Numeric(12, 2)`
- Pydantic: `condecimal(max_digits=12, decimal_places=2)`
- **Never convert to float at any point, not even once, not even in a log line.**

### 8.4 Balances are computed live, never cached

See §3. If caching ever becomes necessary, it needs a guarded write with a version
column — but the recommendation is not to.

### 8.5 Group-level authorization on every group-scoped endpoint

Authentication middleware only establishes *who you are*. Verifying *whether you
belong to this group* must happen in the handler, or in a dependency that receives
`group_id`.

Non-members get **403** — not 404, not 401.

### 8.6 Expense participants must belong to the group

A non-member listed as a participant is a 400.

### 8.7 A settlement's payer and recipient must differ

Enforced by a database CHECK constraint and validated in Pydantic.

### 8.8 Remainder distribution is deterministic

Always a fixed, reproducible order. No sets, no unordered dict iteration.

---

## 9. Edge Cases

Each needs a test.

### Expenses
- 0.01 split across 3 people → `0.01, 0.00, 0.00`. Not an error.
- 100 split to a single participant who also paid → their net is 0.
- amount of 0 or negative → 400
- the same participant listed twice → 400
- PATCH → **delete all existing splits and recreate them**, in one transaction.
  Never update rows individually.
- DELETE → splits cascade, and balances change immediately.

### Group membership
- Removing a member whose net balance ≠ 0 → **409**, and the response states the
  outstanding amount. Allowing it would break §8.1.
- Removing a member whose net is 0 but who has expense history → allowed, but the
  history must survive. Keep the user_id; do not cascade-delete expenses.
- Adding an existing member → 409
- **The last member leaving is allowed; the group may be empty. The group is never
  auto-deleted** — deleting it would destroy expense history, contradicting the
  rule above.

### Group membership — acceptance (§7.1)
- Inviting a user (`POST .../members`) creates a **PENDING** row; they are not a
  member until they accept. Re-inviting a PENDING (or ACTIVE) user → 409.
- A PENDING member on any group-scoped endpoint → **403**, identical to a
  non-member. Their only valid actions are accept/decline.
- `accept` / `decline` with no PENDING row for that caller in that group → 404.
  A caller can only accept or decline their **own** invitation.
- A PENDING member's id as an expense payer/participant, or named in a
  settlement → 400 ("not a member of this group").
- `/balances` and `/settle-up` never include a PENDING member.
- `DELETE .../members/{uid}` on a PENDING row always succeeds (net is trivially
  0). On an ACTIVE member it is unchanged (409 if net ≠ 0).
- `GET /api/groups` excludes a group where the caller is only PENDING.

### Settlements
- Paying more than owed → allowed (the payer becomes a creditor), but return a
  warning field in the response.
- Paying someone outside the group → 400
- amount ≤ 0 → 400

### Debt simplification
- A fully settled group → `[]`
- A single-member group → `[]`
- An empty group → `[]`

---

## 10. Conventions carried over from a previous project

These are fixes for bugs already encountered once. Apply them from day one.

### 10.1 Decimal serializes as a string in JSON
Pydantic emits `Decimal` as a JSON string (`"33.34"`, not `33.34`). The frontend
must parse before arithmetic and format for display. Write **one** money helper on
day one; never let `Number()` spread through the codebase.

### 10.2 401 and 403 are different
| Code | Meaning | Example |
|---|---|---|
| 401 | not authenticated | missing or expired token |
| 403 | authenticated but not permitted | not a member of this group |

Frontend: 401 → send to login; 403 → show an error, stay logged in.

### 10.3 The login endpoint must be exempt from the 401 interceptor
A wrong password legitimately returns 401. If the frontend's global 401 handler
catches it, the app redirects to the login page in a loop and the user never sees
the error. Exclude `/api/auth/login` and `/api/auth/register` from that handler.

### 10.4 Login failures return identical messages
"Email not found" and "wrong password" must produce byte-for-byte identical
responses, to prevent user enumeration. **Add a test that compares the two strings
directly.**

### 10.5 Validate at the boundary
Pydantic validates at the edge. Past that point, data is trusted.

### 10.6 Centralized error handling
Use `@app.exception_handler()`. Every route returns the same error shape; no route
builds its own error response.

### 10.7 Test isolation
Tests must pass in any order. Verify with both `pytest -p no:randomly` and
`pytest --randomly-seed=...`. Use per-test transaction rollback rather than deleting
rows.

Development and test databases must be separate, and the test fixture should refuse
to run if the target database name does not contain `test`.

### 10.8 CI must actually verify something
A previous pipeline stayed green while verifying nothing: a frontend build missing
an env var tree-shook the entire application away and still exited 0.

Do not trust a green pipeline until you have watched it turn red for the right
reason. Assert on real signals — build artifact size, expected strings — not just
exit codes.

### 10.9 A check is not a lock
An `if` before a write guarantees nothing under concurrency.
- Concurrent duplicate member inserts → rely on `UNIQUE (group_id, user_id)`.
- Removing a member while an expense referencing them is being created → check
  membership inside the same transaction as the insert.

### 10.10 Git workflow
Branch per feature (`feat/`, `fix/`, `chore/`). Open pull requests; never push
directly to main. Never commit `.env` — and note that adding it to `.gitignore`
afterwards does not help; it must be purged from history.

### 10.11 `CLAUDE.md` exists from day one
Not retrofitted. It carries every invariant in §8.

---

## 11. Build Order

See the separate execution plan. The only ordering constraint that matters:
the split engine (§6) is built and tested as pure logic **before** it is wired to
any endpoint, and expenses exist before balances.

---

## 12. Testing

### Unit tests (no database)

**`test_split_calculation.py`** — the most important file in the suite:
- 300 across 3 → `100.00, 100.00, 100.00`
- 100 across 3 → `33.34, 33.33, 33.33`, **summing to exactly 100.00**
- 0.01 across 3 → `0.01, 0.00, 0.00`
- 100 across 1 → `100.00`
- PERCENTAGE `33.33 / 33.33 / 33.34` of 100
- SHARES `2:1:1` of 100 → `50.00, 25.00, 25.00`
- EXACT with a mismatched sum → raises
- PERCENTAGE not summing to 100 → raises
- SHARES containing zero or negative → raises
- **Property test (hypothesis):** random totals and participant counts, ≥1000
  examples; the split always sums to the total exactly and no share is negative.

**`test_debt_simplification.py`**
- settled group → `[]`
- a single debt → 1 transfer
- cycle A→B→C→A with equal amounts → `[]`
- many members → transfer count ≤ N−1
- **Property test:** random balances summing to 0; after applying every transfer,
  everyone is at net 0.

### Integration tests
- `test_auth.py` — registration, duplicates, identical login error messages
- `test_groups.py` — creation, membership, non-members get 403
- `test_expenses.py` — all four split types, validation failures, non-member
  participants → 400
- `test_balances.py` — net balances sum to 0 after every operation
- `test_settlements.py` — balances update correctly; removing a member with an
  outstanding balance → 409

### The test that matters most

```python
def test_group_balances_always_sum_to_zero(client, group_with_expenses):
    """Must hold no matter what was done to the data."""
    balances = get_balances(group_with_expenses.id)
    assert sum(balances.values()) == Decimal("0.00")
```

Per §8.1, run this automatically after every test rather than calling it by hand.

---

## 13. CI

```yaml
1. checkout
2. PostgreSQL 16 service container + health check
3. Python 3.12
4. install dependencies
5. alembic upgrade head      # against an empty database
6. ruff check .
7. mypy app
8. pytest
```

Ordered cheapest-to-most-expensive: a lint failure should not cost a full test run.

Use an ephemeral Postgres container, never a shared development database — shared
state causes cross-contamination, collisions between concurrent runs, and network
latency.

---

## 14. Frontend

React + TypeScript + Vite.

| Screen | Contents |
|---|---|
| Login / Register | |
| Group list | the user's groups plus their own net position in each |
| Group detail | expenses, members, add-expense action |
| Add expense | payer, amount, split type, participants |
| Balance summary | who owes whom |
| Settle up | simplified transfers + record-as-paid |

### 14.1 The form changes with the split type
- EQUAL → pick participants
- EXACT → an amount per person, with a live running total that must equal the
  expense amount before submission is allowed
- PERCENTAGE → a percentage per person, live total must equal 100
- SHARES → a share count per person

### 14.2 Preview the split before submitting
Show what each participant will owe **before** saving, and mark whoever receives an
extra cent explicitly, so the asymmetry is never a surprise.

The frontend preview must follow exactly the same rule as the backend (§6). Port the
largest remainder method and test it against the same cases as the Python suite.

### 14.3 Decimal arrives as a string
`"33.34"`, not `33.34`. One shared helper, used everywhere, from the first commit.

### 14.4 Present balances in human terms
```
You are owed ฿250.00
  ├─ Somchai owes you ฿150.00
  └─ Somying owes you ฿100.00
```
This is more useful than a raw net figure. Surface the `note` from `/settle-up` so
users understand the transfer list is reduced, not provably minimal.
