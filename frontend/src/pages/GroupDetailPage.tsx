/**
 * GroupDetailPage — one group: its members, its expenses, and the way in to the
 * add-expense form (SPEC §14: "expenses, members, add-expense action").
 *
 * A non-member hitting this route gets a 403 from the API; per SPEC §10.2 that
 * shows an inline error and does NOT log the user out.
 */

import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'

import { ApiError, expensesApi, groupsApi } from '../lib/api'
import type { Expense, GroupDetail } from '../lib/api'
import { formatMoney, parseMoney } from '../lib/money'

export function GroupDetailPage() {
  const { groupId } = useParams<{ groupId: string }>()
  const [group, setGroup] = useState<GroupDetail | null>(null)
  const [expenses, setExpenses] = useState<Expense[] | null>(null)
  const [error, setError] = useState<string | null>(null)

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
            <Link className="button-link" to={`/groups/${group.id}/expenses/new`}>
              Add expense
            </Link>
          </header>

          <section>
            <h2>Members</h2>
            <ul className="member-list">
              {group.members.map((m) => (
                <li key={m.user_id}>
                  {m.name} <span className="muted">({m.email})</span>
                </li>
              ))}
            </ul>
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
