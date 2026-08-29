# Frontend — Expense Splitting

React + TypeScript + Vite. Part of the monorepo; the backend lives one level up.

## Setup

```bash
npm install
cp .env.example .env      # optional — defaults work for local dev
npm run dev               # http://localhost:5173, proxies /api -> :8000
```

Run the backend (`uv run uvicorn app.main:app --reload` from the repo root) so
the `/api` proxy has something to talk to.

## Scripts

| Script | What it does |
|---|---|
| `npm run dev` | Vite dev server with `/api` proxied to the backend |
| `npm run build` | `tsc -b` typecheck + production build into `dist/` |
| `npm test` | Vitest (jsdom) — run once |
| `npm run test:watch` | Vitest in watch mode |
| `npm run lint` | oxlint |

## Money — read `src/lib/money.ts` before touching any amount

The backend serializes `Decimal` as a **string** (`"33.34"`, never `33.34`).
`src/lib/money.ts` is the only place money is parsed, added, or formatted:

- money is represented internally as an integer number of **cents**;
- `parseMoney` / `formatMoney` / `addMoney` / `sumMoney` / `toApiString` are the API;
- **`Number()` and `parseFloat()` must not appear anywhere else under `src/`** —
  CI greps for violations (SPEC §10.1, §14.3).

## Split preview — `src/lib/split.ts`

The add-expense form previews each participant's share **before** saving (§14.2).
That preview must match the backend byte for byte, so `src/lib/split.ts` is a
direct port of `app/services/splitting.py`'s largest remainder method (§6):
floor every ideal share to the cent, then hand the leftover cents out one at a
time in participant order (§8.8). `src/lib/split.test.ts` pins it to the same
cases as `tests/test_split_calculation.py` — 100 across 3 → 33.34 / 33.33 /
33.33, summing to exactly 100.00.

`splitEqual` / `splitExact` / `splitByPercentage` / `splitByShares` each return
the per-participant `Money` map plus `remainderRecipients` — the participants
who got the odd `+฿0.01`, which the form marks explicitly.

## Screens (SPEC §14)

| Route | Screen |
|---|---|
| `/` | Group list — each group with the caller's net position (green = owed to you, red = you owe) |
| `/groups/:groupId` | Group detail — members + expense list + "Add expense" |
| `/groups/:groupId/expenses/new` | Add expense — the form reshapes per split type (§14.1) with a live preview (§14.2) |

## Auth (`src/lib/api.ts`)

`apiFetch` attaches the JWT automatically and handles auth failures. **401 and
403 are deliberately separate** (SPEC §10.2):

- **401** → session gone: clear the token, redirect to `/login`.
- **403** → authenticated but not allowed: surface an error, **stay logged in**.

`/api/auth/login` and `/api/auth/register` pass `anonymous: true`, which opts
them **out** of the 401 redirect. A wrong password returns 401; if the
interceptor caught it, the app would loop back to `/login` and the user would
never see the error (SPEC §10.3).

### Manual check — wrong password stays on the page

Automated in `src/pages/LoginPage.test.tsx`
(`keeps the error visible on the login page and does not navigate away`).
To verify by hand:

1. `npm run dev`, open `/login`.
2. Enter a registered email with the wrong password and submit.
3. **Expected:** the page stays on `/login` and shows
   "Incorrect email or password" (or the backend's generic message). No reload,
   no redirect loop.
