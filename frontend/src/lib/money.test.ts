import { describe, expect, it } from 'vitest'

import {
  addMoney,
  formatMoney,
  type Money,
  negateMoney,
  parseMoney,
  subMoney,
  sumMoney,
  toApiString,
  ZERO,
} from './money'

const m = (n: number) => n as Money

describe('parseMoney', () => {
  it('parses the backend Decimal string shape into cents', () => {
    expect(parseMoney('33.34')).toBe(3334)
    expect(parseMoney('100.00')).toBe(10000)
    expect(parseMoney('0.00')).toBe(0)
    expect(parseMoney('0.01')).toBe(1)
    expect(parseMoney('5')).toBe(500)
    expect(parseMoney('0.1')).toBe(10)
  })

  it('parses negative amounts (debtor balances)', () => {
    expect(parseMoney('-100.00')).toBe(-10000)
    expect(parseMoney('-0.01')).toBe(-1)
  })

  it('tolerates surrounding whitespace', () => {
    expect(parseMoney('  12.50 ')).toBe(1250)
  })

  it('rejects anything that is not a plain decimal string', () => {
    for (const bad of ['', 'abc', '1.234', '1e3', 'NaN', '1,000.00', '.5', '5.', '- 5', '++5']) {
      expect(() => parseMoney(bad), bad).toThrow()
    }
  })
})

describe('formatMoney', () => {
  it('renders two decimals with the currency prefix', () => {
    expect(formatMoney(m(3334))).toBe('฿33.34')
    expect(formatMoney(m(10000))).toBe('฿100.00')
    expect(formatMoney(m(5))).toBe('฿0.05')
    expect(formatMoney(ZERO)).toBe('฿0.00')
  })

  it('renders negatives with a leading minus', () => {
    expect(formatMoney(m(-10000))).toBe('-฿100.00')
    expect(formatMoney(m(-1))).toBe('-฿0.01')
  })
})

describe('arithmetic', () => {
  it('adds and subtracts exactly', () => {
    expect(addMoney(m(3334), m(3333))).toBe(6667)
    expect(subMoney(m(10000), m(3334))).toBe(6666)
    expect(negateMoney(m(2500))).toBe(-2500)
  })

  it('sums an empty list to ZERO', () => {
    expect(sumMoney([])).toBe(0)
  })

  it('the largest-remainder split of 100 across 3 sums to exactly 100.00 (SPEC §6)', () => {
    const shares = ['33.34', '33.33', '33.33'].map(parseMoney)
    expect(sumMoney(shares)).toBe(parseMoney('100.00'))
    expect(formatMoney(sumMoney(shares))).toBe('฿100.00')
  })

  it('0.01 split across 3 (0.01, 0.00, 0.00) still sums to 0.01', () => {
    const shares = ['0.01', '0.00', '0.00'].map(parseMoney)
    expect(sumMoney(shares)).toBe(parseMoney('0.01'))
  })
})

describe('toApiString', () => {
  it('is the inverse of parseMoney', () => {
    for (const s of ['33.34', '100.00', '0.00', '0.01', '-100.00', '-0.01', '7.50']) {
      expect(toApiString(parseMoney(s))).toBe(
        // parseMoney('5') -> '5.00'; normalize the expectation the same way
        s.includes('.') ? s : `${s}.00`,
      )
    }
  })
})
