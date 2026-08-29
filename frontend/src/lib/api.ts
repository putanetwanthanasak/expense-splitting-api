/**
 * api.ts — the single fetch wrapper for the whole app.
 *
 * Responsibilities:
 *   1. Attach the JWT (`Authorization: Bearer …`) automatically.
 *   2. 401 -> the session is gone: clear the token and redirect to /login.
 *   3. 403 -> authenticated but not allowed: surface an error, stay logged in.
 *
 * 401 and 403 are handled by strictly separate branches (SPEC §10.2).
 *
 * IMPORTANT (SPEC §10.3): `/api/auth/login` and `/api/auth/register` are exempt
 * from the 401 branch. A wrong password on login legitimately returns 401; if
 * the interceptor caught it, the app would redirect to /login in a loop and the
 * user would never see the "wrong password" message. Those two paths pass
 * `anonymous: true`, which both skips the stale-token header AND opts out of the
 * 401 redirect.
 */

import { clearToken, getToken } from './token'

/** Base URL for the API. Empty in dev (Vite proxies /api -> backend). */
const BASE_URL = import.meta.env.VITE_API_BASE_URL ?? ''

const LOGIN_PATH = '/login'

export class ApiError extends Error {
  readonly status: number
  readonly detail: string

  constructor(status: number, detail: string) {
    super(detail)
    this.name = 'ApiError'
    this.status = status
    this.detail = detail
  }
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE'
  body?: unknown
  /**
   * Send without the JWT and opt out of the 401 redirect. Use for
   * `/api/auth/login` and `/api/auth/register` only (SPEC §10.3).
   */
  anonymous?: boolean
  signal?: AbortSignal
}

async function readDetail(res: Response): Promise<string> {
  try {
    const data: unknown = await res.json()
    if (
      data !== null &&
      typeof data === 'object' &&
      'detail' in data &&
      typeof (data as { detail: unknown }).detail === 'string'
    ) {
      return (data as { detail: string }).detail
    }
    return JSON.stringify(data)
  } catch {
    return res.statusText || `HTTP ${res.status}`
  }
}

function redirectToLogin(): void {
  clearToken()
  if (typeof window !== 'undefined' && window.location.pathname !== LOGIN_PATH) {
    window.location.assign(LOGIN_PATH)
  }
}

export async function apiFetch<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }

  const token = getToken()
  if (token && !opts.anonymous) {
    headers.Authorization = `Bearer ${token}`
  }

  const res = await fetch(`${BASE_URL}${path}`, {
    method: opts.method ?? 'GET',
    headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    signal: opts.signal,
  })

  // --- 401: not authenticated -----------------------------------------------
  // Session is gone. Clear the token and bounce to /login — UNLESS this is an
  // auth endpoint (anonymous), where 401 just means "bad credentials" and must
  // reach the caller so the form can show it (SPEC §10.3).
  if (res.status === 401) {
    const detail = await readDetail(res)
    if (!opts.anonymous) {
      redirectToLogin()
    }
    throw new ApiError(401, detail)
  }

  // --- 403: authenticated but not permitted -------------------------------
  // Show an error only. NEVER clear the token or redirect (SPEC §10.2).
  if (res.status === 403) {
    throw new ApiError(403, await readDetail(res))
  }

  if (!res.ok) {
    throw new ApiError(res.status, await readDetail(res))
  }

  if (res.status === 204) {
    return undefined as T
  }
  return (await res.json()) as T
}

// --- Typed endpoint helpers ------------------------------------------------

export interface TokenResponse {
  access_token: string
  token_type: string
}

export interface User {
  id: string
  email: string
  name: string
  created_at: string
}

export const authApi = {
  login: (email: string, password: string): Promise<TokenResponse> =>
    apiFetch<TokenResponse>('/api/auth/login', {
      method: 'POST',
      body: { email, password },
      anonymous: true,
    }),

  register: (email: string, password: string, name: string): Promise<User> =>
    apiFetch<User>('/api/auth/register', {
      method: 'POST',
      body: { email, password, name },
      anonymous: true,
    }),

  me: (): Promise<User> => apiFetch<User>('/api/users/me'),
}

// --- Groups --------------------------------------------------------------

export interface Group {
  id: string
  name: string
  created_by_user_id: string
  created_at: string
}

export interface GroupMember {
  user_id: string
  email: string
  name: string
  joined_at: string
}

export interface GroupDetail extends Group {
  members: GroupMember[]
}

/**
 * One member's net position in a group. `net_balance` is a backend `Decimal`,
 * so it arrives as a string ("150.00", "-40.00") — parse it with
 * `parseMoney` before doing anything with it (SPEC §10.1). Positive = others
 * owe this member; negative = this member owes.
 */
export interface BalanceEntry {
  user_id: string
  net_balance: string
}

export interface GroupBalances {
  balances: BalanceEntry[]
}

export const groupsApi = {
  list: (): Promise<Group[]> => apiFetch<Group[]>('/api/groups'),

  get: (groupId: string): Promise<GroupDetail> =>
    apiFetch<GroupDetail>(`/api/groups/${groupId}`),

  create: (name: string): Promise<Group> =>
    apiFetch<Group>('/api/groups', { method: 'POST', body: { name } }),

  balances: (groupId: string): Promise<GroupBalances> =>
    apiFetch<GroupBalances>(`/api/groups/${groupId}/balances`),
}

// --- Expenses ----------------------------------------------------------

export type SplitType = 'EQUAL' | 'EXACT' | 'PERCENTAGE' | 'SHARES'

export interface Expense {
  id: string
  group_id: string
  paid_by_user_id: string
  amount: string
  description: string
  expense_date: string
  split_type: SplitType
  created_at: string
}

export interface ExpensePage {
  items: Expense[]
  total: number
  limit: number
  offset: number
}

export interface ExpenseSplit {
  user_id: string
  amount_owed: string
}

export interface ExpenseDetail extends Expense {
  splits: ExpenseSplit[]
}

interface ExpenseWriteCommon {
  amount: string
  description: string
  expense_date: string
  paid_by_user_id: string
}

/**
 * Discriminated on `split_type`, matching the backend's discriminated-union
 * request body (`app/schemas/expense.py`): EQUAL carries a plain participant
 * list, the other three carry a per-participant value. Money / percentage /
 * share values are all sent as strings — the shape the backend's `Decimal`
 * fields expect.
 */
export type ExpenseCreateBody =
  | (ExpenseWriteCommon & { split_type: 'EQUAL'; participant_user_ids: string[] })
  | (ExpenseWriteCommon & {
      split_type: 'EXACT'
      splits: { user_id: string; amount: string }[]
    })
  | (ExpenseWriteCommon & {
      split_type: 'PERCENTAGE'
      splits: { user_id: string; percentage: string }[]
    })
  | (ExpenseWriteCommon & {
      split_type: 'SHARES'
      splits: { user_id: string; shares: string }[]
    })

export const expensesApi = {
  list: (groupId: string): Promise<ExpensePage> =>
    apiFetch<ExpensePage>(`/api/groups/${groupId}/expenses`),

  create: (groupId: string, body: ExpenseCreateBody): Promise<ExpenseDetail> =>
    apiFetch<ExpenseDetail>(`/api/groups/${groupId}/expenses`, {
      method: 'POST',
      body,
    }),
}

// --- Settle up / settlements -----------------------------------------

/** One suggested repayment from the simplified transfer list (§5). */
export interface Transfer {
  from_user_id: string
  to_user_id: string
  amount: string
}

export interface SettleUp {
  transfers: Transfer[]
  /**
   * The backend's own words about what the transfer list is — a greedy
   * reduction, NOT a proven minimum (§5). Show it to the user verbatim; never
   * paraphrase it into a stronger claim.
   */
  note: string
}

export interface Settlement {
  id: string
  group_id: string
  from_user_id: string
  to_user_id: string
  amount: string
  settled_at: string
}

/** POST response: the created settlement plus a one-off `warning` (§9) — set
 * when the payer paid more than they owed and flipped to a net creditor. */
export interface SettlementRecord extends Settlement {
  warning: string | null
}

export interface SettlementCreateBody {
  from_user_id: string
  to_user_id: string
  amount: string
}

export const settlementsApi = {
  settleUp: (groupId: string): Promise<SettleUp> =>
    apiFetch<SettleUp>(`/api/groups/${groupId}/settle-up`),

  list: (groupId: string): Promise<Settlement[]> =>
    apiFetch<Settlement[]>(`/api/groups/${groupId}/settlements`),

  create: (groupId: string, body: SettlementCreateBody): Promise<SettlementRecord> =>
    apiFetch<SettlementRecord>(`/api/groups/${groupId}/settlements`, {
      method: 'POST',
      body,
    }),
}
