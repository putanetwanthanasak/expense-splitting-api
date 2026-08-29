/**
 * balance-summary.ts — turn a viewer's net balance + the simplified transfer
 * list into readable Thai, the shape SPEC §14.4 asks for:
 *
 *   คุณควรได้รับคืน ฿250.00
 *     ├─ สมชาย ควรจ่ายคุณ ฿150.00
 *     └─ สมหญิง ควรจ่ายคุณ ฿100.00
 *
 * Pure: plain values in, plain values out, no React and no `fetch` — so the
 * phrasing is unit-tested directly (`balance-summary.test.ts`). The headline
 * amount comes from `/balances` (authoritative net, §4); the breakdown lines
 * come from `/settle-up` (§5), whose incoming/outgoing amounts for the viewer
 * always add back up to that net.
 */

import type { Transfer } from './api'
import { formatMoney, negateMoney, parseMoney, ZERO } from './money'
import type { Money } from './money'

export type ViewerStanding = 'creditor' | 'debtor' | 'settled'

export interface BalanceLine {
  /** The other party in this line — used as a stable React key. */
  userId: string
  text: string
}

export interface ViewerBalanceSummary {
  standing: ViewerStanding
  headline: string
  lines: BalanceLine[]
}

export function describeViewerBalance(args: {
  viewerId: string
  /** The viewer's net balance for the group, from `/balances`. */
  net: Money
  /** The simplified transfer list for the group, from `/settle-up`. */
  transfers: readonly Transfer[]
  nameOf: (userId: string) => string
}): ViewerBalanceSummary {
  const { viewerId, net, transfers, nameOf } = args

  if (net === ZERO) {
    return { standing: 'settled', headline: 'คุณไม่มียอดค้างในกลุ่มนี้', lines: [] }
  }

  if (net > ZERO) {
    const incoming = transfers.filter((t) => t.to_user_id === viewerId)
    return {
      standing: 'creditor',
      headline: `คุณควรได้รับคืน ${formatMoney(net)}`,
      lines: incoming.map((t) => ({
        userId: t.from_user_id,
        text: `${nameOf(t.from_user_id)} ควรจ่ายคุณ ${formatMoney(parseMoney(t.amount))}`,
      })),
    }
  }

  const outgoing = transfers.filter((t) => t.from_user_id === viewerId)
  return {
    standing: 'debtor',
    headline: `คุณค้างชำระ ${formatMoney(negateMoney(net))}`,
    lines: outgoing.map((t) => ({
      userId: t.to_user_id,
      text: `คุณควรจ่าย ${nameOf(t.to_user_id)} ${formatMoney(parseMoney(t.amount))}`,
    })),
  }
}
