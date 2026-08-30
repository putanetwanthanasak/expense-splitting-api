/**
 * GroupDetailPage — one group: its members, its expenses, the way in to the
 * add-expense form, and inviting new members (SPEC §14, §7.1: "expenses,
 * members, add-expense action" plus Phase 14's invite-member form).
 *
 * A non-member hitting this route gets a 403 from the API; per SPEC §10.2 that
 * shows an inline error and does NOT log the user out.
 *
 * The member list includes PENDING rows now (§7.1) -- an invited member who
 * hasn't accepted yet -- shown with a de-emphasized "pending" tag. They can't
 * be an expense payer or participant per backend validation; that picker
 * (AddExpensePage) filters to ACTIVE only.
 */

import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useParams } from 'react-router-dom'

import { ApiError, expensesApi, groupsApi, usersApi } from '../lib/api'
import type { Expense, GroupDetail, UserLookupOut } from '../lib/api'
import { formatMoney, parseMoney } from '../lib/money'

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
                ? "You don't have access to this group."
                : err.detail
              : 'Could not load this group.',
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
    group?.members.find((m) => m.user_id === userId)?.name ?? 'Unknown'

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
        setLookupNotice('No account found with that email.')
      } else {
        setInviteError(err instanceof ApiError ? err.detail : 'Could not look up that email.')
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
        setInviteNotice('Already invited or already a member of this group.')
      } else {
        setInviteError(err instanceof ApiError ? err.detail : 'Could not send the invite.')
      }
    } finally {
      setInviting(false)
    }
  }

  return (
    <main className="page">
      <p>
        <Link to="/">← All groups</Link>
      </p>

      {error !== null && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}

      {group === null && error === null && <p className="centered-status">Loading…</p>}

      {group !== null && (
        <>
          <header className="page-head">
            <h1>{group.name}</h1>
            <nav className="page-actions">
              <Link className="button-link" to={`/groups/${group.id}/expenses/new`}>
                Add expense
              </Link>
              <Link
                className="button-link secondary"
                to={`/groups/${group.id}/balances`}
              >
                Balances
              </Link>
              <Link
                className="button-link secondary"
                to={`/groups/${group.id}/settle`}
              >
                Settle up
              </Link>
            </nav>
          </header>

          <section>
            <h2>Members</h2>
            <ul className="member-list">
              {group.members.map((m) => (
                <li key={m.user_id}>
                  {m.name} <span className="muted">({m.email})</span>
                  {m.status === 'PENDING' && <span className="pending-tag">pending</span>}
                </li>
              ))}
            </ul>

            <form className="inline-form invite-form" onSubmit={onLookupSubmit}>
              <input
                type="email"
                aria-label="Email to invite"
                placeholder="Invite by email"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                required
              />
              <button type="submit" disabled={lookingUp || inviteEmail.trim() === ''}>
                {lookingUp ? 'Looking up…' : 'Invite'}
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
                  Invite {lookupResult.name} ({lookupResult.email}) to this group?
                </p>
                <div className="invite-confirm-actions">
                  <button type="button" onClick={confirmInvite} disabled={inviting}>
                    {inviting ? 'Inviting…' : 'Confirm invite'}
                  </button>
                  <button
                    type="button"
                    className="secondary"
                    onClick={cancelInvite}
                    disabled={inviting}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </section>

          <section>
            <h2>Expenses</h2>

            {expenses !== null && expenses.length === 0 && (
              <p className="centered-status">No expenses yet.</p>
            )}

            {expenses !== null && expenses.length > 0 && (
              <ul className="expense-list">
                {expenses.map((e) => (
                  <li key={e.id}>
                    <span className="expense-desc">{e.description}</span>
                    <span className="expense-meta">
                      {formatMoney(parseMoney(e.amount))} · paid by{' '}
                      {nameOf(e.paid_by_user_id)} · {e.expense_date} · {e.split_type}
                    </span>
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
