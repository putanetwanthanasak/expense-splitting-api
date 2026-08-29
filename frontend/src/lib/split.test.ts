/**
 * split.test.ts — the frontend split engine, checked case-for-case against
 * `tests/test_split_calculation.py` so the add-expense preview (§14.2) and the
 * backend (§6) provably agree. Every `it(...)` here has a named counterpart in
 * the Python suite; the headline case is 100 across 3 -> 33.34 / 33.33 / 33.33
 * summing to exactly 100.00.
 */

import { describe, expect, it } from 'vitest'

import { formatMoney, parseMoney, type Money } from './money'
import {
  HUNDRED_PERCENT,
  parsePercent,
  parseShareCount,
  SplitValidationError,
  splitByPercentage,
  splitByShares,
  splitEqual,
  splitExact,
  toPercentApiString,
  type Percent,
} from './split'

const money = parseMoney
const pct = (s: string): Percent => parsePercent(s)
const ids = (n: number): string[] => Array.from({ length: n }, (_, i) => `u${i + 1}`)

// --- splitEqual (test_split_equally_*) -----------------------------------

describe('splitEqual', () => {
  it('300 across 3 divides evenly', () => {
    const [a, b, c] = ids(3)
    const { shares, remainderRecipients } = splitEqual(money('300'), [a, b, c])

    expect(shares).toEqual(
      new Map<string, Money>([
        [a, money('100.00')],
        [b, money('100.00')],
        [c, money('100.00')],
      ]),
    )
    expect(remainderRecipients).toEqual([])
  })

  it('100 across 3 gives the extra cent to the first participant', () => {
    const [a, b, c] = ids(3)
    const { shares, remainderRecipients } = splitEqual(money('100'), [a, b, c])

    expect(shares.get(a)).toBe(money('33.34'))
    expect(shares.get(b)).toBe(money('33.33'))
    expect(shares.get(c)).toBe(money('33.33'))
    expect([...shares.values()].reduce((s, v) => s + v, 0)).toBe(money('100.00'))
    expect(remainderRecipients).toEqual([a])
  })

  it('the 100-across-3 shares format back to ฿33.34 / ฿33.33 and sum to ฿100.00', () => {
    const [a, b, c] = ids(3)
    const { shares } = splitEqual(money('100'), [a, b, c])

    expect(formatMoney(shares.get(a)!)).toBe('฿33.34')
    expect(formatMoney(shares.get(b)!)).toBe('฿33.33')
    expect(formatMoney(shares.get(c)!)).toBe('฿33.33')
  })

  it('0.01 across 3 does not throw — (0.01, 0.00, 0.00)', () => {
    const [a, b, c] = ids(3)
    const { shares } = splitEqual(money('0.01'), [a, b, c])

    expect(shares.get(a)).toBe(money('0.01'))
    expect(shares.get(b)).toBe(money('0.00'))
    expect(shares.get(c)).toBe(money('0.00'))
  })

  it('100 across 1 person', () => {
    const [a] = ids(1)
    expect(splitEqual(money('100'), [a]).shares).toEqual(
      new Map<string, Money>([[a, money('100.00')]]),
    )
  })

  it('the extra cent follows input order, not id order (§8.8)', () => {
    const [a, b, c] = ids(3)
    const { shares } = splitEqual(money('100'), [c, a, b])

    expect(shares.get(c)).toBe(money('33.34'))
    expect(shares.get(a)).toBe(money('33.33'))
    expect(shares.get(b)).toBe(money('33.33'))
  })

  it('an empty participant list raises', () => {
    expect(() => splitEqual(money('100'), [])).toThrow(SplitValidationError)
  })

  it('a duplicate participant raises', () => {
    const [a] = ids(1)
    expect(() => splitEqual(money('100'), [a, a])).toThrow(SplitValidationError)
  })
})

// --- splitExact (test_split_exact_*) ------------------------------------

describe('splitExact', () => {
  it('accepts amounts that sum to the total', () => {
    const [a, b, c] = ids(3)
    const { shares, remainderRecipients } = splitExact(money('300'), [
      { userId: a, amount: money('150.00') },
      { userId: b, amount: money('100.00') },
      { userId: c, amount: money('50.00') },
    ])

    expect(shares).toEqual(
      new Map<string, Money>([
        [a, money('150.00')],
        [b, money('100.00')],
        [c, money('50.00')],
      ]),
    )
    expect(remainderRecipients).toEqual([])
  })

  it('a mismatched sum raises', () => {
    const [a, b] = ids(2)
    expect(() =>
      splitExact(money('300'), [
        { userId: a, amount: money('150.00') },
        { userId: b, amount: money('100.00') },
      ]),
    ).toThrow(SplitValidationError)
  })

  it('an empty entry list raises', () => {
    expect(() => splitExact(money('100'), [])).toThrow(SplitValidationError)
  })
})

// --- splitByPercentage (test_split_by_percentage_*) --------------------

describe('splitByPercentage', () => {
  it('33.33 / 33.33 / 33.34 of 100', () => {
    const [a, b, c] = ids(3)
    const { shares } = splitByPercentage(money('100'), [
      { userId: a, percent: pct('33.33') },
      { userId: b, percent: pct('33.33') },
      { userId: c, percent: pct('33.34') },
    ])

    expect(shares.get(a)).toBe(money('33.33'))
    expect(shares.get(b)).toBe(money('33.33'))
    expect(shares.get(c)).toBe(money('33.34'))
    expect([...shares.values()].reduce((s, v) => s + v, 0)).toBe(money('100.00'))
  })

  it('parts not summing to 100 raise', () => {
    const [a, b] = ids(2)
    expect(() =>
      splitByPercentage(money('100'), [
        { userId: a, percent: pct('50') },
        { userId: b, percent: pct('40') },
      ]),
    ).toThrow(SplitValidationError)
  })

  it('an empty entry list raises', () => {
    expect(() => splitByPercentage(money('100'), [])).toThrow(SplitValidationError)
  })

  it('HUNDRED_PERCENT is 100.00 and round-trips through the API string form', () => {
    expect(HUNDRED_PERCENT).toBe(pct('100'))
    expect(toPercentApiString(pct('33.33'))).toBe('33.33')
    expect(toPercentApiString(pct('100'))).toBe('100.00')
  })
})

// --- splitByShares (test_split_by_shares_*) ---------------------------

describe('splitByShares', () => {
  it('2:1:1 of 100 -> 50.00 / 25.00 / 25.00', () => {
    const [a, b, c] = ids(3)
    const { shares } = splitByShares(money('100'), [
      { userId: a, shares: 2 },
      { userId: b, shares: 1 },
      { userId: c, shares: 1 },
    ])

    expect(shares).toEqual(
      new Map<string, Money>([
        [a, money('50.00')],
        [b, money('25.00')],
        [c, money('25.00')],
      ]),
    )
  })

  it('a zero share raises', () => {
    const [a, b] = ids(2)
    expect(() =>
      splitByShares(money('100'), [
        { userId: a, shares: 1 },
        { userId: b, shares: 0 },
      ]),
    ).toThrow(SplitValidationError)
  })

  it('a negative share raises', () => {
    const [a, b] = ids(2)
    expect(() =>
      splitByShares(money('100'), [
        { userId: a, shares: 2 },
        { userId: b, shares: -1 },
      ]),
    ).toThrow(SplitValidationError)
  })

  it('an empty entry list raises', () => {
    expect(() => splitByShares(money('100'), [])).toThrow(SplitValidationError)
  })
})

// --- parsers ----------------------------------------------------------

describe('parsePercent / parseShareCount', () => {
  it('parses percentage strings into hundredths of a percent', () => {
    expect(parsePercent('33.33')).toBe(3333)
    expect(parsePercent('100')).toBe(10000)
    expect(parsePercent('0')).toBe(0)
    expect(parsePercent('12.5')).toBe(1250)
    expect(parsePercent('  50 ')).toBe(5000)
  })

  it('rejects malformed percentages', () => {
    for (const bad of ['', '-5', '1.234', '1e2', 'abc', '.5', '5.']) {
      expect(() => parsePercent(bad), bad).toThrow(SplitValidationError)
    }
  })

  it('parses whole share counts and rejects the rest', () => {
    expect(parseShareCount('2')).toBe(2)
    expect(parseShareCount(' 10 ')).toBe(10)
    for (const bad of ['', '-1', '1.5', 'x', '2e1']) {
      expect(() => parseShareCount(bad), bad).toThrow(SplitValidationError)
    }
  })
})

// --- exhaustive check, the deterministic stand-in for the hypothesis
//     property test in tests/test_split_calculation.py -----------------

describe('splitEqual always sums to the total exactly and is never negative', () => {
  it('holds for every total 1..2000 cents across 1..12 participants', () => {
    for (let totalCents = 1; totalCents <= 2000; totalCents += 1) {
      const total = totalCents as Money
      for (let n = 1; n <= 12; n += 1) {
        const participants = ids(n)
        const { shares } = splitEqual(total, participants)

        const sum = [...shares.values()].reduce((s, v) => s + v, 0)
        expect(sum).toBe(totalCents)
        expect([...shares.values()].every((v) => v >= 0)).toBe(true)
        expect(shares.size).toBe(n)
      }
    }
  })
})
