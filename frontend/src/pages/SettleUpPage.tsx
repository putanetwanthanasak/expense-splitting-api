/**
 * SettleUpPage — the simplified transfer list (§5) with a "mark as paid" action
 * per row, plus the settlement history for the group.
 *
 * SPEC §5 / CLAUDE.md are firm that this list is a *reduction*, not a proven
 * minimum: the backend's own `note` is shown verbatim, with a plain-language
 * Thai gloss that says it lowers the number of transfers and nothing stronger.
 * A fully-settled group shows an empty state, never an empty table (§14.4).
 */

import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'

import { ApiError, groupsApi, settlementsApi } from '../lib/api'
import type { GroupDetail, Settlement, SettleUp, Transfer } from '../lib/api'
import { formatMoney, parseMoney } from '../lib/money'

interface Loaded {
  group: GroupDetail
  settleUp: SettleUp
  history: Settlement[]
}

const transferKey = (t: Transfer): string =>
  `${t.from_user_id}|${t.to_user_id}|${t.amount}`

async function fetchSettleData(id: string): Promise<Loaded> {
  const [group, settleUp, history] = await Promise.all([
    groupsApi.get(id),
    settlementsApi.settleUp(id),
    settlementsApi.list(id),
  ])
  return { group, settleUp, history }
}

function toMessage(err: unknown): string {
  if (err instanceof ApiError) {
    return err.status === 403 ? 'คุณไม่มีสิทธิ์เข้าถึงกลุ่มนี้' : err.detail
  }
  return 'โหลดข้อมูลการชำระยอดไม่สำเร็จ'
}

function formatSettledAt(iso: string): string {
  const when = new Date(iso)
  if (Number.isNaN(when.getTime())) return iso
  try {
    return new Intl.DateTimeFormat('th-TH', {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(when)
  } catch {
    return iso.slice(0, 16).replace('T', ' ')
  }
}

export function SettleUpPage() {
  const { groupId } = useParams<{ groupId: string }>()
  const [data, setData] = useState<Loaded | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pendingKey, setPendingKey] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [warning, setWarning] = useState<string | null>(null)

  useEffect(() => {
    const id = groupId
    if (!id) return
    let cancelled = false

    fetchSettleData(id)
      .then((loaded) => {
        if (!cancelled) {
          setData(loaded)
          setError(null)
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(toMessage(err))
      })

    return () => {
      cancelled = true
    }
  }, [groupId])

  const nameOf = (userId: string): string =>
    data?.group.members.find((m) => m.user_id === userId)?.name ?? 'ไม่ทราบชื่อ'

  async function markPaid(t: Transfer) {
    if (!groupId) return
    setPendingKey(transferKey(t))
    setActionError(null)
    setWarning(null)
    try {
      const record = await settlementsApi.create(groupId, {
        from_user_id: t.from_user_id,
        to_user_id: t.to_user_id,
        amount: t.amount,
      })
      if (record.warning) setWarning(record.warning)
      setData(await fetchSettleData(groupId))
    } catch (err) {
      setActionError(
        err instanceof ApiError ? err.detail : 'บันทึกการชำระเงินไม่สำเร็จ',
      )
    } finally {
      setPendingKey(null)
    }
  }

  return (
    <main className="page settle-up-page">
      <p>
        <Link to={`/groups/${groupId}`}>← กลับไปที่กลุ่ม</Link>
      </p>
      <header className="page-head">
        <div className="page-head-titles">
          <h1>ชำระยอด</h1>
          {/* Figma 2:1393 (§ Settle Up investigation, item 2): real
              interpolation from the group already loaded on this page.
              Desktop's own frame (13:210/13:229) DOES have a subtitle
              node too — unlike Balance Summary/Login/Register, where
              desktop had none or a wholly different concept — but its
              exact wording/order differs ("{group} · จัดกลุ่มการโอนให้
              เหลือน้อยลง" vs mobile's "รายการโอนที่แนะนำ · {group}") and
              desktop hasn't implemented its own version yet either
              (checked: no .settle-up-page .page-subtitle rule exists).
              So this stays hidden on desktop for now — a genuine deferred
              desktop gap, not "no such concept applies there." */}
          {data !== null && (
            <p className="page-subtitle">รายการโอนที่แนะนำ · {data.group.name}</p>
          )}
        </div>
      </header>

      {error !== null && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}

      {data === null && error === null && <p className="centered-status">กำลังโหลด…</p>}

      {data !== null && (
        <>
          <section>
            <h2>รายการที่แนะนำให้ชำระ</h2>

            {data.settleUp.transfers.length === 0 ? (
              <div className="empty-state">
                <p className="empty-state-emoji" aria-hidden="true">
                  🎉
                </p>
                <p>กลุ่มนี้ชำระยอดครบแล้ว — ไม่มีรายการที่ต้องชำระ</p>
              </div>
            ) : (
              <>
                {warning !== null && <p className="notice">{warning}</p>}
                {actionError !== null && (
                  <p role="alert" className="form-error">
                    {actionError}
                  </p>
                )}

                <ul className="transfer-list">
                  {data.settleUp.transfers.map((t) => {
                    const key = transferKey(t)
                    return (
                      <li key={key} className="transfer-row">
                        <span>
                          {nameOf(t.from_user_id)} ควรจ่าย {nameOf(t.to_user_id)}{' '}
                          <strong>{formatMoney(parseMoney(t.amount))}</strong>
                        </span>
                        <button
                          type="button"
                          onClick={() => markPaid(t)}
                          disabled={pendingKey !== null}
                        >
                          {pendingKey === key ? 'กำลังบันทึก…' : 'ทำเครื่องหมายว่าชำระแล้ว'}
                        </button>
                      </li>
                    )
                  })}
                </ul>

                {/* Figma 2:1406 (§ Settle Up investigation, item 3): moved
                    to AFTER the transfer list, matching Figma's position —
                    content is untouched (both paragraphs, verbatim). The
                    backend's own SETTLE_UP_NOTE (paragraph 1) and this
                    caveat (paragraph 2) are the enforcement of the SPEC §5
                    "never say minimum/optimal" rule; collapsing to
                    Figma's single line would drop the only Thai-language
                    instance of that caveat, so it stays as two paragraphs,
                    restyled only (ds/color/text-faint + 16.2px, matching
                    2:1406's own binding). */}
                <div className="settle-note">
                  <p>{data.settleUp.note}</p>
                  <p className="muted">
                    รายการนี้ช่วย<strong>ลดจำนวนครั้งของการโอน</strong>{' '}
                    ไม่ได้รับประกันว่าจะเป็นจำนวนครั้งที่น้อยที่สุดเท่าที่เป็นไปได้
                  </p>
                </div>
              </>
            )}
          </section>

          <section>
            <h2>ประวัติการชำระเงิน</h2>
            {data.history.length === 0 ? (
              <div className="empty-state">
                {/* Figma 2:1415/2:1417/2:1418 (§ Settle Up investigation,
                    item 6): title matches the existing shipped sentence
                    exactly already ("ยังไม่มีประวัติการชำระเงิน") — no
                    drift there. Description is genuinely new (shipped had
                    none at all), pulled verbatim from mobile's 2:1418, not
                    invented — but it's mobile-only (hidden on desktop,
                    styles/desktop.css): desktop's own frame (13:210, node
                    13:252) has a real but DIFFERENT description
                    ("...รายการจะบันทึกไว้ที่นี่ พร้อมวันที่และจำนวนเงิน"),
                    not audited/decided for desktop in this pass, so mobile's
                    wording doesn't leak there. */}
                <p className="empty-state-emoji" aria-hidden="true">
                  🧾
                </p>
                <p>ยังไม่มีประวัติการชำระเงิน</p>
                <p className="muted history-empty-desc">
                  เมื่อมีการทำเครื่องหมายว่าจ่ายแล้ว รายการจะอยู่ที่นี่
                </p>
              </div>
            ) : (
              <ul className="history-list">
                {data.history.map((s) => (
                  <li key={s.id}>
                    <span>
                      {nameOf(s.from_user_id)} จ่าย {nameOf(s.to_user_id)}{' '}
                      <strong>{formatMoney(parseMoney(s.amount))}</strong>
                    </span>
                    <span className="muted">{formatSettledAt(s.settled_at)}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </main>
  )
}
