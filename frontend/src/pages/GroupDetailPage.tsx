/**
 * GroupDetailPage — one group: its members, its expenses, the way in to the
 * add-expense form, inviting new members, editing/deleting expenses, and
 * removing members (SPEC §14, §7.1, §9: "expenses, members, add-expense
 * action" plus Phase 14's invite-member form and Phase 15's edit/delete).
 *
 * A non-member hitting this route gets a 403 from the API; per SPEC §10.2 that
 * shows an inline error and does NOT log the user out.
 *
 * The member list includes PENDING rows now (§7.1) -- an invited member who
 * hasn't accepted yet -- shown with a de-emphasized "pending" tag. They can't
 * be an expense payer or participant per backend validation; that picker
 * (AddExpensePage) filters to ACTIVE only. Removing a PENDING member revokes
 * their invitation (§7.1/§9) -- same endpoint, same "Remove" button.
 *
 * Expense delete and member removal both use the same inline two-step
 * confirm pattern already established here for inviting a member: a
 * "Confirm?" state in place of the single action button, never a native
 * `window.confirm()`.
 */

import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useParams } from 'react-router-dom'

import { ApiError, expensesApi, groupsApi, usersApi } from '../lib/api'
import type {
  Expense,
  GroupDetail,
  GroupMember,
  SplitType,
  UserLookupOut,
} from '../lib/api'
import { formatMoney, negateMoney, parseMoney } from '../lib/money'
import type { Money } from '../lib/money'

/** Thai display labels for the split-type enum shown in an expense's meta line. */
const SPLIT_TYPE_TH: Record<SplitType, string> = {
  EQUAL: 'เท่ากัน',
  EXACT: 'ระบุจำนวน',
  PERCENTAGE: 'เปอร์เซ็นต์',
  SHARES: 'สัดส่วน',
}

export function GroupDetailPage() {
  const { groupId } = useParams<{ groupId: string }>()
  const [group, setGroup] = useState<GroupDetail | null>(null)
  const [expenses, setExpenses] = useState<Expense[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  // --- invite-member form (§7.1, Phase 14) --------------------------------
  const [inviteEmail, setInviteEmail] = useState('')
  const [lookingUp, setLookingUp] = useState(false)
  const [lookupResult, setLookupResult] = useState<UserLookupOut | null>(null)
  const [lookupNotice, setLookupNotice] = useState<string | null>(null)
  const [inviting, setInviting] = useState(false)
  const [inviteNotice, setInviteNotice] = useState<string | null>(null)
  const [inviteError, setInviteError] = useState<string | null>(null)

  // --- remove member (§7.1, §9, Phase 15) ---------------------------------
  const [removingMemberId, setRemovingMemberId] = useState<string | null>(null)
  const [removeMemberPending, setRemoveMemberPending] = useState(false)
  const [removeMemberNotice, setRemoveMemberNotice] = useState<string | null>(null)
  const [removeMemberError, setRemoveMemberError] = useState<string | null>(null)

  // --- delete expense (Phase 15) ------------------------------------------
  const [deletingExpenseId, setDeletingExpenseId] = useState<string | null>(null)
  const [deleteExpensePending, setDeleteExpensePending] = useState(false)
  const [deleteExpenseError, setDeleteExpenseError] = useState<string | null>(null)

  useEffect(() => {
    const id = groupId
    if (!id) return
    let cancelled = false

    const load = async () => {
      try {
        const [detail, page] = await Promise.all([
          groupsApi.get(id),
          expensesApi.list(id),
        ])
        if (!cancelled) {
          setGroup(detail)
          setExpenses(page.items)
          setError(null)
        }
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof ApiError
              ? err.status === 403
                ? 'คุณไม่มีสิทธิ์เข้าถึงกลุ่มนี้'
                : err.detail
              : 'โหลดข้อมูลกลุ่มไม่สำเร็จ',
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
    group?.members.find((m) => m.user_id === userId)?.name ?? 'ไม่ทราบชื่อ'

  async function onLookupSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const email = inviteEmail.trim()
    if (email === '') return

    setLookingUp(true)
    setLookupNotice(null)
    setLookupResult(null)
    setInviteError(null)
    setInviteNotice(null)
    try {
      setLookupResult(await usersApi.lookup(email))
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        setLookupNotice('ไม่พบบัญชีที่ใช้อีเมลนี้')
      } else {
        setInviteError(err instanceof ApiError ? err.detail : 'ค้นหาอีเมลนี้ไม่สำเร็จ')
      }
    } finally {
      setLookingUp(false)
    }
  }

  function cancelInvite() {
    setLookupResult(null)
    setLookupNotice(null)
    setInviteError(null)
    setInviteNotice(null)
  }

  async function confirmInvite() {
    if (!lookupResult || !groupId) return
    setInviting(true)
    setInviteError(null)
    setInviteNotice(null)
    try {
      const member = await groupsApi.addMember(groupId, lookupResult.id)
      setGroup((g) => (g ? { ...g, members: [...g.members, member] } : g))
      setInviteEmail('')
      setLookupResult(null)
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setInviteNotice('ผู้ใช้นี้ถูกเชิญหรือเป็นสมาชิกของกลุ่มนี้อยู่แล้ว')
      } else {
        setInviteError(err instanceof ApiError ? err.detail : 'ส่งคำเชิญไม่สำเร็จ')
      }
    } finally {
      setInviting(false)
    }
  }

  function startRemoveMember(userId: string) {
    setRemovingMemberId(userId)
    setRemoveMemberNotice(null)
    setRemoveMemberError(null)
  }

  function cancelRemoveMember() {
    setRemovingMemberId(null)
    setRemoveMemberNotice(null)
    setRemoveMemberError(null)
  }

  async function confirmRemoveMember(member: GroupMember) {
    if (!groupId) return
    setRemoveMemberPending(true)
    setRemoveMemberNotice(null)
    setRemoveMemberError(null)
    try {
      await groupsApi.removeMember(groupId, member.user_id)
      setGroup((g) =>
        g ? { ...g, members: g.members.filter((m) => m.user_id !== member.user_id) } : g,
      )
      setRemovingMemberId(null)
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        const outstanding = extractOutstandingBalance(err.detail)
        setRemoveMemberNotice(
          outstanding !== null
            ? `นำ ${member.name} ออกไม่ได้ — ยังมียอดค้างชำระอยู่ ` +
                `${formatMoney(outstanding)} กรุณาเคลียร์ยอดก่อน`
            : `นำ ${member.name} ออกไม่ได้ — ยังมียอดค้างชำระอยู่ กรุณาเคลียร์ยอดก่อน`,
        )
      } else {
        setRemoveMemberError(
          err instanceof ApiError ? err.detail : 'นำสมาชิกออกไม่สำเร็จ',
        )
      }
    } finally {
      setRemoveMemberPending(false)
    }
  }

  function startDeleteExpense(expenseId: string) {
    setDeletingExpenseId(expenseId)
    setDeleteExpenseError(null)
  }

  function cancelDeleteExpense() {
    setDeletingExpenseId(null)
    setDeleteExpenseError(null)
  }

  async function confirmDeleteExpense(expenseId: string) {
    setDeleteExpensePending(true)
    setDeleteExpenseError(null)
    try {
      await expensesApi.remove(expenseId)
      setExpenses((prev) => (prev ? prev.filter((e) => e.id !== expenseId) : prev))
      setDeletingExpenseId(null)
    } catch (err) {
      setDeleteExpenseError(
        err instanceof ApiError ? err.detail : 'ลบรายการนี้ไม่สำเร็จ',
      )
    } finally {
      setDeleteExpensePending(false)
    }
  }

  return (
    <main className="page group-detail-page">
      <p>
        <Link to="/">← กลุ่มทั้งหมด</Link>
      </p>

      {error !== null && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}

      {group === null && error === null && <p className="centered-status">กำลังโหลด…</p>}

      {group !== null && (
        <>
          <header className="page-head">
            <h1>{group.name}</h1>
            <nav className="page-actions">
              <Link className="button-link" to={`/groups/${group.id}/expenses/new`}>
                + เพิ่มค่าใช้จ่าย
              </Link>
              <Link
                className="button-link secondary"
                to={`/groups/${group.id}/balances`}
              >
                ยอดคงเหลือ
              </Link>
              <Link
                className="button-link secondary"
                to={`/groups/${group.id}/settle`}
              >
                เคลียร์ยอด
              </Link>
            </nav>
          </header>

          <section>
            <h2>สมาชิก</h2>
            <ul className="member-list">
              {group.members.map((m) => (
                <li key={m.user_id}>
                  <span>
                    {m.name} <span className="muted">({m.email})</span>
                    {m.status === 'PENDING' && (
                      <span className="pending-tag">รอการยอมรับ</span>
                    )}
                  </span>
                  {removingMemberId === m.user_id ? (
                    <span className="confirm-inline">
                      นำ {m.name} ออก?
                      <button
                        type="button"
                        onClick={() => confirmRemoveMember(m)}
                        disabled={removeMemberPending}
                      >
                        {removeMemberPending ? 'กำลังนำออก…' : 'ยืนยัน'}
                      </button>
                      <button
                        type="button"
                        className="secondary"
                        onClick={cancelRemoveMember}
                        disabled={removeMemberPending}
                      >
                        ยกเลิก
                      </button>
                    </span>
                  ) : (
                    <button
                      type="button"
                      className="secondary"
                      onClick={() => startRemoveMember(m.user_id)}
                    >
                      นำออก
                    </button>
                  )}
                </li>
              ))}
            </ul>

            {removeMemberNotice !== null && <p className="notice">{removeMemberNotice}</p>}
            {removeMemberError !== null && (
              <p role="alert" className="form-error">
                {removeMemberError}
              </p>
            )}

            <form className="inline-form invite-form" onSubmit={onLookupSubmit}>
              <input
                type="email"
                aria-label="อีเมลที่ต้องการเชิญ"
                placeholder="เชิญสมาชิกด้วยอีเมล"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                required
              />
              <button type="submit" disabled={lookingUp || inviteEmail.trim() === ''}>
                {lookingUp ? 'กำลังค้นหา…' : '+ เชิญสมาชิก'}
              </button>
            </form>

            {lookupNotice !== null && <p className="notice">{lookupNotice}</p>}
            {inviteNotice !== null && <p className="notice">{inviteNotice}</p>}
            {inviteError !== null && (
              <p role="alert" className="form-error">
                {inviteError}
              </p>
            )}

            {lookupResult !== null && (
              <div className="invite-confirm">
                <p>
                  เชิญ {lookupResult.name} ({lookupResult.email}) เข้ากลุ่มนี้หรือไม่?
                </p>
                <div className="invite-confirm-actions">
                  <button type="button" onClick={confirmInvite} disabled={inviting}>
                    {inviting ? 'กำลังเชิญ…' : 'ยืนยันการเชิญ'}
                  </button>
                  <button
                    type="button"
                    className="secondary"
                    onClick={cancelInvite}
                    disabled={inviting}
                  >
                    ยกเลิก
                  </button>
                </div>
              </div>
            )}
          </section>

          <section>
            <h2>รายการค่าใช้จ่าย</h2>

            {expenses !== null && expenses.length === 0 && (
              <p className="centered-status">ยังไม่มีรายการค่าใช้จ่าย</p>
            )}

            {expenses !== null && expenses.length > 0 && (
              <ul className="expense-list">
                {expenses.map((e) => (
                  <li key={e.id}>
                    <span className="expense-desc">{e.description}</span>
                    <span className="expense-amount">
                      {formatMoney(parseMoney(e.amount))}
                    </span>
                    <span className="expense-meta">
                      {nameOf(e.paid_by_user_id)} จ่าย · {e.expense_date} ·{' '}
                      {SPLIT_TYPE_TH[e.split_type]}
                    </span>
                    <div className="expense-actions">
                      <Link
                        className="button-link secondary"
                        to={`/groups/${group.id}/expenses/${e.id}/edit`}
                      >
                        แก้ไข
                      </Link>
                      {deletingExpenseId === e.id ? (
                        <span className="confirm-inline">
                          ลบรายการนี้?
                          <button
                            type="button"
                            onClick={() => confirmDeleteExpense(e.id)}
                            disabled={deleteExpensePending}
                          >
                            {deleteExpensePending ? 'กำลังลบ…' : 'ยืนยัน'}
                          </button>
                          <button
                            type="button"
                            className="secondary"
                            onClick={cancelDeleteExpense}
                            disabled={deleteExpensePending}
                          >
                            ยกเลิก
                          </button>
                        </span>
                      ) : (
                        <button
                          type="button"
                          className="secondary"
                          onClick={() => startDeleteExpense(e.id)}
                        >
                          ลบ
                        </button>
                      )}
                    </div>
                    {deletingExpenseId === e.id && deleteExpenseError !== null && (
                      <p role="alert" className="form-error">
                        {deleteExpenseError}
                      </p>
                    )}
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

/**
 * DELETE /api/groups/{id}/members/{uid}'s 409 body is
 * `{ detail: { message, outstanding_balance } }` -- `detail` isn't a plain
 * string, so `api.ts`'s `readDetail` falls back to JSON-stringifying the
 * whole response, and that's what ends up in `ApiError.detail` here. Parse
 * it back out rather than showing raw JSON to the user; `null` if the shape
 * doesn't match (a caller should fall back to a generic message).
 */
function extractOutstandingBalance(detailJson: string): Money | null {
  try {
    const parsed: unknown = JSON.parse(detailJson)
    if (
      parsed === null ||
      typeof parsed !== 'object' ||
      !('detail' in parsed) ||
      parsed.detail === null ||
      typeof parsed.detail !== 'object' ||
      !('outstanding_balance' in parsed.detail) ||
      typeof (parsed.detail as { outstanding_balance: unknown }).outstanding_balance !== 'string'
    ) {
      return null
    }
    const raw = (parsed.detail as { outstanding_balance: string }).outstanding_balance
    const cents = parseMoney(raw)
    return cents < 0 ? negateMoney(cents) : cents
  } catch {
    return null
  }
}
