/**
 * split.ts — the frontend port of the backend's largest remainder method
 * (docs/SPEC.md §6, mirrored one-to-one from `app/services/splitting.py`).
 *
 * §14.2 requires the add-expense preview to show *exactly* what the backend
 * will store: same rounding, same "who gets the odd cent", same order. The only
 * way to guarantee that is to run the identical algorithm on the client and
 * pin it to the identical cases — see `split.test.ts`, which mirrors
 * `tests/test_split_calculation.py` case for case.
 *
 * Every value here is an integer number of cents (`Money` from money.ts) or an
 * integer number of hundredths-of-a-percent (`Percent`). All arithmetic is
 * integer arithmetic — never the float-parsing globals money.ts also avoids
 * (SPEC §10.1; CI greps `src/` for violations).
 */

import { sumMoney, type Money } from './money'

/**
 * Raised when a split's inputs are invalid: an EXACT total that doesn't match,
 * PERCENTAGE parts that don't sum to 100, a non-positive SHARES count, an empty
 * participant list, or a duplicate participant. Never raised for a rounding
 * failure — the largest remainder method guarantees an exact split for valid
 * input, and `distribute()` asserts that rather than trusting it.
 */
export class SplitValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SplitValidationError'
  }
}

/**
 * A percentage as an integer number of *hundredths of a percent*:
 * `"33.33"` -> `3333`, `"100"` -> `10000`. Branded so a bare `number` can't be
 * passed where a parsed `Percent` is expected.
 */
export type Percent = number & { readonly __brand: 'Percent' }

/** 100.00% — the value every PERCENTAGE split's parts must sum to. */
export const HUNDRED_PERCENT = 10000 as Percent

export interface ExactEntry {
  userId: string
  amount: Money
}

export interface PercentEntry {
  userId: string
  percent: Percent
}

export interface ShareEntry {
  userId: string
  shares: number
}

export interface SplitResult {
  /** Per-participant amount owed, keyed by user id, in participant/input order. */
  shares: Map<string, Money>
  /**
   * Participants who received one extra remainder cent, in distribution order
   * (SPEC §8.8). Empty when the amount divided evenly and for EXACT splits.
   * Each listed participant got exactly +0.01 — never more than one cent.
   */
  remainderRecipients: string[]
}

/** Fold a run of ASCII digits into an integer without any float-parsing global. */
function foldDigits(digits: string): number {
  let acc = 0
  for (let i = 0; i < digits.length; i += 1) {
    acc = acc * 10 + (digits.charCodeAt(i) - 48 /* '0' */)
  }
  return acc
}

/**
 * Parse a percentage string ("33.33", "100", "0", "12.5") into `Percent`
 * (hundredths of a percent). Rejects a leading `-`, 3+ decimals, exponents and
 * anything else — loudly, rather than guessing.
 */
export function parsePercent(raw: string): Percent {
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(raw.trim())
  if (!match) {
    throw new SplitValidationError(`not a percentage: ${JSON.stringify(raw)}`)
  }
  const [, whole, frac = ''] = match
  return (foldDigits(whole) * 100 + foldDigits(frac.padEnd(2, '0'))) as Percent
}

/** `Percent` -> the plain string the API's `percentage` field wants: `3333` -> `"33.33"`. */
export function toPercentApiString(percent: Percent): string {
  const whole = Math.trunc(percent / 100)
  const rest = percent % 100
  return `${whole}.${rest < 10 ? `0${rest}` : `${rest}`}`
}

/** `Percent` for display: `3333` -> `"33.33%"`. */
export function formatPercent(percent: Percent): string {
  return `${toPercentApiString(percent)}%`
}

/**
 * Parse a whole share count ("2", "10"). Rejects decimals, signs and blanks —
 * the frontend only offers integer shares; whether it's > 0 is checked by
 * `splitByShares`, matching how `splitting.py` splits shape from rule.
 */
export function parseShareCount(raw: string): number {
  const s = raw.trim()
  if (!/^\d+$/.test(s)) {
    throw new SplitValidationError(`not a whole share count: ${JSON.stringify(raw)}`)
  }
  return foldDigits(s)
}

function assertUnique(userIds: readonly string[]): void {
  if (new Set(userIds).size !== userIds.length) {
    throw new SplitValidationError('split participants must be unique')
  }
}

/**
 * Round every ideal share down to the cent (the caller has already done this
 * into `floored`), then hand out the leftover cents one at a time, in `order`,
 * so the shares sum back to `total` exactly — the largest remainder method
 * (`app/services/splitting.py::_distribute_largest_remainder`).
 *
 * Flooring a share can only understate it, by strictly less than one cent, so
 * across `order.length` participants the shortfall is strictly fewer than
 * `order.length` cents — every leftover cent has a distinct participant in
 * `order` to land on. Both that bound and the final sum are asserted: a
 * violation means this port has drifted from `splitting.py`, and that must
 * fail loudly rather than silently corrupt a balance (SPEC §8.1, §8.2).
 */
function distribute(
  total: Money,
  floored: Map<string, number>,
  order: readonly string[],
): SplitResult {
  let assigned = 0
  for (const cents of floored.values()) {
    assigned += cents
  }

  const leftover = total - assigned
  if (leftover < 0 || leftover >= order.length) {
    throw new Error(
      `largest-remainder invariant broken: ${leftover} leftover cents across ` +
        `${order.length} participants — split.ts has drifted from splitting.py`,
    )
  }

  const shares = new Map<string, Money>()
  order.forEach((id, index) => {
    shares.set(id, ((floored.get(id) ?? 0) + (index < leftover ? 1 : 0)) as Money)
  })

  let check = 0
  for (const cents of shares.values()) {
    check += cents
  }
  if (check !== total) {
    throw new Error(
      'largest-remainder distribution did not sum to the total — bug in split.ts',
    )
  }

  return { shares, remainderRecipients: order.slice(0, leftover) }
}

/**
 * Split `total` evenly across `userIds`. Extra cents go to `userIds[0]`,
 * `userIds[1]`, … in list order (SPEC §8.8). At least one participant; no
 * duplicates.
 */
export function splitEqual(total: Money, userIds: readonly string[]): SplitResult {
  if (userIds.length === 0) {
    throw new SplitValidationError('EQUAL split requires at least one participant')
  }
  assertUnique(userIds)

  const base = Math.floor(total / userIds.length)
  const floored = new Map<string, number>(userIds.map((id) => [id, base] as const))
  return distribute(total, floored, userIds)
}

/**
 * EXACT split: every amount is given directly. The one rule (SPEC §6: "EXACT is
 * the only type that needs no rounding") is that the amounts sum to `total`
 * exactly — a mismatch is rejected, never silently adjusted.
 */
export function splitExact(total: Money, entries: readonly ExactEntry[]): SplitResult {
  if (entries.length === 0) {
    throw new SplitValidationError('EXACT split requires at least one participant')
  }
  assertUnique(entries.map((e) => e.userId))

  const provided = sumMoney(entries.map((e) => e.amount))
  if (provided !== total) {
    throw new SplitValidationError(
      `EXACT amounts sum to ${provided} cents, which does not match the ` +
        `expense total of ${total} cents`,
    )
  }

  return {
    shares: new Map(entries.map((e) => [e.userId, e.amount] as const)),
    remainderRecipients: [],
  }
}

/**
 * Split `total` proportionally to each participant's percentage. Percentages
 * must sum to exactly 100 — rejected otherwise, never normalized. Each ideal
 * share `total * pct / 100` is floored; the leftover cents go to the first
 * participants in `entries` order.
 */
export function splitByPercentage(
  total: Money,
  entries: readonly PercentEntry[],
): SplitResult {
  if (entries.length === 0) {
    throw new SplitValidationError('PERCENTAGE split requires at least one participant')
  }
  assertUnique(entries.map((e) => e.userId))

  let sum = 0
  for (const entry of entries) {
    sum += entry.percent
  }
  if (sum !== HUNDRED_PERCENT) {
    throw new SplitValidationError(
      `percentages sum to ${toPercentApiString(sum as Percent)}, which does not equal 100`,
    )
  }

  const order = entries.map((e) => e.userId)
  const floored = new Map<string, number>(
    entries.map(
      (e) => [e.userId, Math.floor((total * e.percent) / HUNDRED_PERCENT)] as const,
    ),
  )
  return distribute(total, floored, order)
}

/**
 * Split `total` proportionally to each participant's share count (e.g. 2:1:1).
 * Every share must be a whole number strictly greater than 0. Each ideal share
 * `total * count / totalShares` is floored; the leftover cents go to the first
 * participants in `entries` order.
 */
export function splitByShares(
  total: Money,
  entries: readonly ShareEntry[],
): SplitResult {
  if (entries.length === 0) {
    throw new SplitValidationError('SHARES split requires at least one participant')
  }
  assertUnique(entries.map((e) => e.userId))

  for (const entry of entries) {
    if (!Number.isInteger(entry.shares) || entry.shares <= 0) {
      throw new SplitValidationError(
        `share for ${entry.userId} must be a whole number > 0, got ${entry.shares}`,
      )
    }
  }

  let totalShares = 0
  for (const entry of entries) {
    totalShares += entry.shares
  }

  const order = entries.map((e) => e.userId)
  const floored = new Map<string, number>(
    entries.map(
      (e) => [e.userId, Math.floor((total * e.shares) / totalShares)] as const,
    ),
  )
  return distribute(total, floored, order)
}
