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
      <header className="page-head">
        <div className="page-head-titles">
          <h1>ยอดคงเหลือ</h1>
          {/* Figma 2:1342 (§ Balance Summary investigation, item 1): real
              interpolation from the group already loaded on this page, not
              a literal string — desktop's own frame (13:146/13:165) models
              a DIFFERENT subtitle concept (a last-updated timestamp the API
              doesn't provide anywhere), so this is mobile-only, same as
              Group Detail's subtitle. */}
          {data !== null && (
            <p className="page-subtitle">{data.group.name} · สรุปเป็นภาษาง่าย ๆ</p>
          )}
        </div>
      </header>

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
            const name = nameOf(row.userId)
            const isViewer = row.userId === viewerId
            // Figma 2:1360/2:1361 (§ Balance Summary investigation, item 3):
            // despite the Figma layer name "Pending tag", this marks the
            // viewer's OWN row — "คุณ / you" — not a membership-status
            // indicator (§8.5's PENDING-absent-from-/balances rule doesn't
            // apply here). Desktop's own frame (13:146, node 13:199) has no
            // such pill at all; it bakes the same idea straight into the
            // text ("... (คุณ) · ..."), which is exactly what was already
            // shipped here. So both render: .you-text (plain suffix) is
            // shown on desktop / hidden on mobile, .you-badge (the new
            // pill, ds/color/brand-wash + ds/color/brand — an identity
            // accent, not Group Detail's warning-toned PENDING tag, a
            // different concept entirely) is shown on mobile / hidden on
            // desktop (styles/desktop.css) — each breakpoint matches its
            // own real Figma source, neither loses the "this is you"
            // information.
            const youMarker = isViewer && (
              <>
                <span className="you-text"> (คุณ)</span>
                <span className="you-badge">คุณ / you</span>
              </>
            )
            if (row.net > ZERO) {
              return (
                <li key={row.userId} className="net-pos">
                  {name}
                  {youMarker} — ควรได้รับคืน {formatMoney(row.net)}
                </li>
              )
            }
            if (row.net < ZERO) {
              return (
                <li key={row.userId} className="net-neg">
                  {name}
                  {youMarker} — ค้างชำระ {formatMoney(negateMoney(row.net))}
                </li>
              )
            }
            return (
              <li key={row.userId} className="net-zero">
                {name}
                {youMarker} — ไม่มียอดค้าง
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
