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
        <h1>ชำระยอด</h1>
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
                <div className="settle-note">
                  <p>{data.settleUp.note}</p>
                  <p className="muted">
                    รายการนี้ช่วย<strong>ลดจำนวนครั้งของการโอน</strong>{' '}
                    ไม่ได้รับประกันว่าจะเป็นจำนวนครั้งที่น้อยที่สุดเท่าที่เป็นไปได้
                  </p>
                </div>

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
              </>
            )}
          </section>

          <section>
            <h2>ประวัติการชำระเงิน</h2>
            {data.history.length === 0 ? (
              <p className="centered-status">ยังไม่มีประวัติการชำระเงิน</p>
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
