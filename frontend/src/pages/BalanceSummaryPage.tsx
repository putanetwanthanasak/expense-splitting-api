/**
 * BalanceSummaryPage — the group's balances "in human terms" (SPEC §14.4), not
 * a table of raw net figures. The viewer's own position is spelled out as Thai
 * text with a per-person tree; every other member's net is listed below it in
 * the same readable style.
 *
 * The headline amount is the viewer's net from `/balances` (§4). The tree lines
 * come from `/settle-up` (§5) — the same simplified transfers the Settle-up
 * screen acts on.
 */

import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'

import { useAuth } from '../auth/auth-context'
import { ApiError, groupsApi, settlementsApi } from '../lib/api'
import type { GroupBalances, GroupDetail, SettleUp } from '../lib/api'
import { describeViewerBalance } from '../lib/balance-summary'
import { formatMoney, negateMoney, parseMoney, ZERO } from '../lib/money'

interface Loaded {
  group: GroupDetail
  balances: GroupBalances
  settleUp: SettleUp
}

export function BalanceSummaryPage() {
  const { groupId } = useParams<{ groupId: string }>()
  const { user } = useAuth()
  const [data, setData] = useState<Loaded | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const id = groupId
    if (!id) return
    let cancelled = false

    const load = async () => {
      try {
        const [group, balances, settleUp] = await Promise.all([
          groupsApi.get(id),
          groupsApi.balances(id),
          settlementsApi.settleUp(id),
        ])
        if (!cancelled) {
          setData({ group, balances, settleUp })
          setError(null)
        }
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof ApiError
              ? err.status === 403
                ? 'คุณไม่มีสิทธิ์เข้าถึงกลุ่มนี้'
                : err.detail
              : 'โหลดยอดคงเหลือไม่สำเร็จ',
          )
        }
      }
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [groupId])

  const nameOf = (userId: string): string =>
    data?.group.members.find((m) => m.user_id === userId)?.name ?? 'ไม่ทราบชื่อ'

  return (
    <main className="page balance-summary-page">
      <p>
        <Link to={`/groups/${groupId}`}>← กลับไปที่กลุ่ม</Link>
      </p>
      <h1>ยอดคงเหลือ</h1>

      {error !== null && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}

      {data === null && error === null && <p className="centered-status">กำลังโหลด…</p>}

      {data !== null && <Summary data={data} viewerId={user?.id ?? ''} nameOf={nameOf} />}
    </main>
  )
}

function Summary({
  data,
  viewerId,
  nameOf,
}: {
  data: Loaded
  viewerId: string
  nameOf: (userId: string) => string
}) {
  const rows = data.balances.balances
    .map((b) => ({ userId: b.user_id, net: parseMoney(b.net_balance) }))
    .sort((a, b) => b.net - a.net)

  const allSettled = rows.every((r) => r.net === ZERO)
  if (allSettled) {
    return (
      <div className="empty-state">
        <p className="empty-state-emoji" aria-hidden="true">
          🎉
        </p>
        <p>กลุ่มนี้ชำระยอดครบแล้ว — ไม่มีใครเป็นหนี้ใคร</p>
        <p>
          <Link to={`/groups/${data.group.id}`}>ดูค่าใช้จ่ายของกลุ่ม</Link>
        </p>
      </div>
    )
  }

  const viewerNet =
    rows.find((r) => r.userId === viewerId)?.net ?? ZERO
  const summary = describeViewerBalance({
    viewerId,
    net: viewerNet,
    transfers: data.settleUp.transfers,
    nameOf,
  })

  return (
    <>
      <section className="balance-summary">
        <p
          className={
            summary.standing === 'creditor'
              ? 'balance-headline net-pos'
              : summary.standing === 'debtor'
                ? 'balance-headline net-neg'
                : 'balance-headline net-zero'
          }
        >
          <span className="balance-headline-label">{summary.headlineLabel}</span>
          {summary.headlineAmount !== null && (
            <span className="balance-headline-amount">{summary.headlineAmount}</span>
          )}
        </p>
        {summary.lines.length > 0 && (
          <ul className="balance-tree">
            {summary.lines.map((line, index) => (
              <li key={line.userId}>
                <span className="tree-branch" aria-hidden="true">
                  {index === summary.lines.length - 1 ? '└─' : '├─'}
                </span>
                {line.text}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2>ยอดของสมาชิกทุกคน</h2>
        <ul className="member-balances">
          {rows.map((row) => {
            const label = nameOf(row.userId) + (row.userId === viewerId ? ' (คุณ)' : '')
            if (row.net > ZERO) {
              return (
                <li key={row.userId} className="net-pos">
                  {label} — ควรได้รับคืน {formatMoney(row.net)}
                </li>
              )
            }
            if (row.net < ZERO) {
              return (
                <li key={row.userId} className="net-neg">
                  {label} — ค้างชำระ {formatMoney(negateMoney(row.net))}
                </li>
              )
            }
            return (
              <li key={row.userId} className="net-zero">
                {label} — ไม่มียอดค้าง
              </li>
            )
          })}
        </ul>
      </section>

      <p>
        <Link className="button-link" to={`/groups/${data.group.id}/settle`}>
          ไปหน้าชำระยอด
        </Link>
      </p>
    </>
  )
}
