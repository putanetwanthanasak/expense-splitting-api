import { describe, expect, it } from 'vitest'

import type { Transfer } from './api'
import { describeViewerBalance } from './balance-summary'
import { parseMoney } from './money'

const NAMES: Record<string, string> = {
  me: 'คุณ',
  somchai: 'สมชาย',
  somying: 'สมหญิง',
}
const nameOf = (id: string) => NAMES[id] ?? id

describe('describeViewerBalance', () => {
  it('renders the §14.4 creditor example: "you should get ฿250.00 back" with a per-debtor tree', () => {
    const transfers: Transfer[] = [
      { from_user_id: 'somchai', to_user_id: 'me', amount: '150.00' },
      { from_user_id: 'somying', to_user_id: 'me', amount: '100.00' },
    ]

    const summary = describeViewerBalance({
      viewerId: 'me',
      net: parseMoney('250.00'),
      transfers,
      nameOf,
    })

    expect(summary.standing).toBe('creditor')
    expect(summary.headline).toBe('คุณควรได้รับคืน ฿250.00')
    expect(summary.lines.map((l) => l.text)).toEqual([
      'สมชาย ควรจ่ายคุณ ฿150.00',
      'สมหญิง ควรจ่ายคุณ ฿100.00',
    ])
  })

  it('renders a debtor as "you should pay X"', () => {
    const transfers: Transfer[] = [
      { from_user_id: 'me', to_user_id: 'somchai', amount: '80.00' },
    ]

    const summary = describeViewerBalance({
      viewerId: 'me',
      net: parseMoney('-80.00'),
      transfers,
      nameOf,
    })

    expect(summary.standing).toBe('debtor')
    expect(summary.headline).toBe('คุณค้างชำระ ฿80.00')
    expect(summary.lines).toEqual([{ userId: 'somchai', text: 'คุณควรจ่าย สมชาย ฿80.00' }])
  })

  it('ignores transfers the viewer is not part of', () => {
    const transfers: Transfer[] = [
      { from_user_id: 'somchai', to_user_id: 'me', amount: '30.00' },
      { from_user_id: 'somying', to_user_id: 'somchai', amount: '10.00' },
    ]

    const summary = describeViewerBalance({
      viewerId: 'me',
      net: parseMoney('30.00'),
      transfers,
      nameOf,
    })

    expect(summary.lines).toEqual([{ userId: 'somchai', text: 'สมชาย ควรจ่ายคุณ ฿30.00' }])
  })

  it('reports a settled viewer with no lines', () => {
    const summary = describeViewerBalance({
      viewerId: 'me',
      net: parseMoney('0.00'),
      transfers: [],
      nameOf,
    })

    expect(summary.standing).toBe('settled')
    expect(summary.headline).toBe('คุณไม่มียอดค้างในกลุ่มนี้')
    expect(summary.lines).toEqual([])
  })
})
