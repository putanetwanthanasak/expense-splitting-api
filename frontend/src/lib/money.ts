/**
 * money.ts — the ONE place money is parsed, added, and formatted (SPEC §10.1, §14.3).
 *
 * The backend serializes `Decimal` as a JSON *string* ("33.34", never the
 * number 33.34). Parsing that with `Number()` / `parseFloat()` reintroduces
 * binary floating point and the lost-cent bugs that SPEC §6 exists to prevent.
 *
 * The rules this module enforces:
 *   - Money is represented internally as an integer number of *cents*.
 *   - All arithmetic is integer arithmetic.
 *   - `Number()` and `parseFloat()` appear nowhere under `src/` except this
 *     file (and this file does not need them). CI greps for violations.
 */

const CURRENCY = '฿'

/**
 * A monetary amount as a whole number of cents. Branded so a bare `number`
 * can't be passed where `Money` is expected without going through this module.
 */
export type Money = number & { readonly __brand: 'Money' }

/** The additive identity, typed as Money. */
export const ZERO = 0 as Money

function assertSafe(cents: number, context: string): void {
  if (!Number.isInteger(cents) || !Number.isSafeInteger(cents)) {
    throw new RangeError(`money out of safe integer range (${context}): ${cents}`)
  }
}

/** Fold a run of ASCII digits into an integer without `Number()`/`parseFloat()`. */
function foldDigits(digits: string): number {
  let acc = 0
  for (let i = 0; i < digits.length; i += 1) {
    acc = acc * 10 + (digits.charCodeAt(i) - 48 /* '0' */)
  }
  return acc
}

/**
 * Parse a backend money string into `Money` (cents).
 *
 * Accepts an optional leading `-`, one or more integer digits, and an optional
 * fractional part of one or two digits: "33.34", "100.00", "0.1", "-5", "0".
 * Rejects everything else — exponents, `NaN`, whitespace-only, 3+ decimals,
 * thousands separators — loudly, rather than guessing.
 */
export function parseMoney(raw: string): Money {
  const s = raw.trim()
  const match = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(s)
  if (!match) {
    throw new Error(`not a money string: ${JSON.stringify(raw)}`)
  }
  const [, sign, whole, frac = ''] = match
  const cents = foldDigits(whole) * 100 + foldDigits(frac.padEnd(2, '0'))
  const signed = sign === '-' ? -cents : cents
  assertSafe(signed, `parseMoney(${JSON.stringify(raw)})`)
  return signed as Money
}

/** Add two amounts. */
export function addMoney(a: Money, b: Money): Money {
  const sum = a + b
  assertSafe(sum, 'addMoney')
  return sum as Money
}

/** Subtract `b` from `a`. */
export function subMoney(a: Money, b: Money): Money {
  const diff = a - b
  assertSafe(diff, 'subMoney')
  return diff as Money
}

/** Negate an amount. */
export function negateMoney(a: Money): Money {
  return -a as Money
}

/** Sum a list of amounts, left to right. Empty list -> ZERO. */
export function sumMoney(values: readonly Money[]): Money {
  return values.reduce<Money>((acc, v) => addMoney(acc, v), ZERO)
}

/**
 * Format `Money` for display: `formatMoney(3334 as Money)` -> `"฿33.34"`.
 * Negative amounts render as `"-฿33.34"`. Always exactly two decimal places.
 */
export function formatMoney(value: Money): string {
  assertSafe(value, 'formatMoney')
  const negative = value < 0
  const abs = negative ? -value : value
  const whole = Math.trunc(abs / 100)
  const cents = abs % 100
  const centsStr = cents < 10 ? `0${cents}` : `${cents}`
  return `${negative ? '-' : ''}${CURRENCY}${whole}.${centsStr}`
}

/**
 * Serialize `Money` back to the string shape the backend expects
 * (`condecimal(max_digits=12, decimal_places=2)`): `3334` -> `"33.34"`.
 * The inverse of `parseMoney` for round-tripping through request bodies.
 */
export function toApiString(value: Money): string {
  assertSafe(value, 'toApiString')
  const negative = value < 0
  const abs = negative ? -value : value
  const whole = Math.trunc(abs / 100)
  const cents = abs % 100
  const centsStr = cents < 10 ? `0${cents}` : `${cents}`
  return `${negative ? '-' : ''}${whole}.${centsStr}`
}
