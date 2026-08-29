/**
 * AddExpensePage — record an expense, with the form reshaping itself around the
 * chosen split type (SPEC §14.1) and a live preview of the resulting split
 * before anything is saved (SPEC §14.2).
 *
 *   EQUAL      → tick participants
 *   EXACT      → an amount per participant + a running total that must equal the
 *                expense amount before submit is allowed
 *   PERCENTAGE → a percentage per participant + a running total that must be 100
 *   SHARES     → a whole share count per participant
 *
 * The preview runs `src/lib/split.ts` — the same largest remainder method the
 * backend uses (§6) — so what it shows is exactly what the server will store,
 * down to which participant receives the odd cent. All money math goes through
 * the money.ts / split.ts helpers; there are no raw numeric casts (§10.1).
 */

import { useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'

import { ApiError, expensesApi, groupsApi } from '../lib/api'
import type { ExpenseCreateBody, GroupMember, SplitType } from '../lib/api'
import { formatMoney, parseMoney, sumMoney, toApiString, ZERO } from '../lib/money'
import type { Money } from '../lib/money'
import {
  parsePercent,
  parseShareCount,
  splitByPercentage,
  splitByShares,
  splitEqual,
  splitExact,
  toPercentApiString,
} from '../lib/split'
import type { Percent, SplitResult } from '../lib/split'

const SPLIT_TYPES: SplitType[] = ['EQUAL', 'EXACT', 'PERCENTAGE', 'SHARES']
const ONE_CENT = parseMoney('0.01')
const TODAY = new Date().toISOString().slice(0, 10)

const valueLabel: Record<SplitType, string> = {
  EQUAL: '',
  EXACT: 'amount',
  PERCENTAGE: 'percent',
  SHARES: 'shares',
}

interface Preview {
  /** The split, once every input for the chosen type is valid; otherwise null. */
  result: SplitResult | null
  /** A hint about why `result` is null (partial input, totals don't match yet). */
  hint: string | null
  /** "฿90.00 of ฿100.00" / "90.00% of 100%" for EXACT / PERCENTAGE; null otherwise. */
  runningTotal: string | null
}

const EMPTY_PREVIEW: Preview = { result: null, hint: null, runningTotal: null }

export function AddExpensePage() {
  const { groupId } = useParams<{ groupId: string }>()
  const navigate = useNavigate()

  const [members, setMembers] = useState<GroupMember[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)

  const [description, setDescription] = useState('')
  const [amountText, setAmountText] = useState('')
  const [dateText, setDateText] = useState(TODAY)
  const [paidBy, setPaidBy] = useState('')
  const [splitType, setSplitType] = useState<SplitType>('EQUAL')
  const [selected, setSelected] = useState<Record<string, boolean>>({})
  const [values, setValues] = useState<Record<string, string>>({})

  const [submitError, setSubmitError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    const id = groupId
    if (!id) return
    let cancelled = false

    groupsApi
      .get(id)
      .then((detail) => {
        if (cancelled) return
        setMembers(detail.members)
        setSelected(
          Object.fromEntries(detail.members.map((m) => [m.user_id, true] as const)),
        )
        setPaidBy(detail.members[0]?.user_id ?? '')
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setLoadError(
          err instanceof ApiError
            ? err.status === 403
              ? "You don't have access to this group."
              : err.detail
            : 'Could not load this group.',
        )
      })

    return () => {
      cancelled = true
    }
  }, [groupId])

  const nameOf = (userId: string): string =>
    members?.find((m) => m.user_id === userId)?.name ?? 'Unknown'

  const amount = useMemo<Money | null>(() => {
    try {
      return parseMoney(amountText)
    } catch {
      return null
    }
  }, [amountText])

  // Participant ids in member order, so the "who gets the odd cent" order here
  // matches the order the backend will see in the request body.
  const participantIds = useMemo(
    () => (members ?? []).filter((m) => selected[m.user_id]).map((m) => m.user_id),
    [members, selected],
  )

  const preview = useMemo<Preview>(() => {
    if (amount === null || amount <= ZERO || participantIds.length === 0) {
      return EMPTY_PREVIEW
    }

    if (splitType === 'EQUAL') {
      try {
        return { result: splitEqual(amount, participantIds), hint: null, runningTotal: null }
      } catch (err) {
        return { result: null, hint: messageOf(err), runningTotal: null }
      }
    }

    if (splitType === 'EXACT') {
      const parsed = tryParseEach(participantIds, values, parseMoney)
      const running = parsed === null ? null : sumMoney(parsed.map((p) => p.value))
      const runningTotal =
        running === null
          ? `— of ${formatMoney(amount)}`
          : `${formatMoney(running)} of ${formatMoney(amount)}`
      if (parsed === null) {
        return { result: null, hint: 'Enter an amount for every ticked participant.', runningTotal }
      }
      try {
        const result = splitExact(
          amount,
          parsed.map((p) => ({ userId: p.userId, amount: p.value })),
        )
        return { result, hint: null, runningTotal }
      } catch (err) {
        return { result: null, hint: messageOf(err), runningTotal }
      }
    }

    if (splitType === 'PERCENTAGE') {
      const parsed = tryParseEach(participantIds, values, parsePercent)
      const runningPct =
        parsed === null
          ? null
          : (parsed.reduce((s, p) => s + p.value, 0) as Percent)
      const runningTotal =
        runningPct === null ? '—% of 100%' : `${toPercentApiString(runningPct)}% of 100%`
      if (parsed === null) {
        return { result: null, hint: 'Enter a percentage for every ticked participant.', runningTotal }
      }
      try {
        const result = splitByPercentage(
          amount,
          parsed.map((p) => ({ userId: p.userId, percent: p.value })),
        )
        return { result, hint: null, runningTotal }
      } catch (err) {
        return { result: null, hint: messageOf(err), runningTotal }
      }
    }

    // SHARES
    const parsed = tryParseEach(participantIds, values, parseShareCount)
    if (parsed === null) {
      return {
        result: null,
        hint: 'Enter a whole share count for every ticked participant.',
        runningTotal: null,
      }
    }
    try {
      const result = splitByShares(
        amount,
        parsed.map((p) => ({ userId: p.userId, shares: p.value })),
      )
      return { result, hint: null, runningTotal: null }
    } catch (err) {
      return { result: null, hint: messageOf(err), runningTotal: null }
    }
  }, [amount, participantIds, splitType, values])

  const canSubmit =
    !submitting &&
    members !== null &&
    description.trim() !== '' &&
    paidBy !== '' &&
    amount !== null &&
    amount > ZERO &&
    participantIds.length > 0 &&
    preview.result !== null

  function toggle(userId: string) {
    setSelected((s) => ({ ...s, [userId]: !(s[userId] ?? false) }))
  }

  function changeSplitType(next: SplitType) {
    setSplitType(next)
    setValues({}) // a "40" means baht under EXACT but percent under PERCENTAGE
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!canSubmit || amount === null || !groupId) return

    setSubmitting(true)
    setSubmitError(null)

    const common = {
      amount: toApiString(amount),
      description: description.trim(),
      expense_date: dateText,
      paid_by_user_id: paidBy,
    }

    let body: ExpenseCreateBody
    if (splitType === 'EQUAL') {
      body = { split_type: 'EQUAL', ...common, participant_user_ids: participantIds }
    } else if (splitType === 'EXACT') {
      body = {
        split_type: 'EXACT',
        ...common,
        splits: participantIds.map((id) => ({
          user_id: id,
          amount: toApiString(parseMoney(values[id] ?? '')),
        })),
      }
    } else if (splitType === 'PERCENTAGE') {
      body = {
        split_type: 'PERCENTAGE',
        ...common,
        splits: participantIds.map((id) => ({
          user_id: id,
          percentage: toPercentApiString(parsePercent(values[id] ?? '')),
        })),
      }
    } else {
      body = {
        split_type: 'SHARES',
        ...common,
        splits: participantIds.map((id) => ({
          user_id: id,
          shares: `${parseShareCount(values[id] ?? '')}`,
        })),
      }
    }

    try {
      await expensesApi.create(groupId, body)
      navigate(`/groups/${groupId}`, { replace: true })
    } catch (err) {
      setSubmitError(err instanceof ApiError ? err.detail : 'Could not save the expense.')
      setSubmitting(false)
    }
  }

  if (loadError !== null) {
    return (
      <main className="page">
        <p>
          <Link to={groupId ? `/groups/${groupId}` : '/'}>← Back</Link>
        </p>
        <p role="alert" className="form-error">
          {loadError}
        </p>
      </main>
    )
  }

  if (members === null) {
    return (
      <main className="page">
        <p className="centered-status">Loading…</p>
      </main>
    )
  }

  return (
    <main className="page">
      <p>
        <Link to={`/groups/${groupId}`}>← Back to group</Link>
      </p>
      <h1>Add expense</h1>

      <form className="expense-form" onSubmit={onSubmit} noValidate>
        <label>
          Description
          <input
            name="description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            required
          />
        </label>

        <label>
          Amount
          <input
            name="amount"
            inputMode="decimal"
            placeholder="0.00"
            value={amountText}
            onChange={(e) => setAmountText(e.target.value)}
            required
          />
        </label>
        {amountText !== '' && amount === null && (
          <p className="split-hint">Enter an amount like 42.50.</p>
        )}

        <label>
          Date
          <input
            type="date"
            name="expense_date"
            value={dateText}
            onChange={(e) => setDateText(e.target.value)}
            required
          />
        </label>

        <label>
          Paid by
          <select value={paidBy} onChange={(e) => setPaidBy(e.target.value)}>
            {members.map((m) => (
              <option key={m.user_id} value={m.user_id}>
                {m.name}
              </option>
            ))}
          </select>
        </label>

        <label>
          Split type
          <select
            value={splitType}
            onChange={(e) => changeSplitType(e.target.value as SplitType)}
          >
            {SPLIT_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>

        <fieldset className="participants">
          <legend>Participants</legend>
          {members.map((m) => {
            const isSelected = selected[m.user_id] ?? false
            return (
              <div className="split-row" key={m.user_id}>
                <label className="split-row-name">
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={() => toggle(m.user_id)}
                  />
                  {m.name}
                </label>
                {isSelected && splitType !== 'EQUAL' && (
                  <input
                    className="split-value"
                    inputMode={splitType === 'SHARES' ? 'numeric' : 'decimal'}
                    aria-label={`${valueLabel[splitType]} for ${m.name}`}
                    value={values[m.user_id] ?? ''}
                    onChange={(e) =>
                      setValues((v) => ({ ...v, [m.user_id]: e.target.value }))
                    }
                  />
                )}
              </div>
            )
          })}
        </fieldset>

        {preview.runningTotal !== null && (
          <p
            className={
              preview.result === null ? 'running-total running-total-off' : 'running-total'
            }
          >
            Running total: {preview.runningTotal}
          </p>
        )}

        {preview.hint !== null && <p className="split-hint">{preview.hint}</p>}

        {preview.result !== null && (
          <div className="preview">
            <h2>Preview</h2>
            <ul>
              {participantIds.map((id) => {
                const share = preview.result?.shares.get(id) ?? ZERO
                const getsExtra = preview.result?.remainderRecipients.includes(id) ?? false
                return (
                  <li key={id}>
                    {nameOf(id)}: {formatMoney(share)}
                    {getsExtra && (
                      <span className="remainder"> (+{formatMoney(ONE_CENT)} remainder)</span>
                    )}
                  </li>
                )
              })}
            </ul>
            {preview.result.remainderRecipients.length > 0 && (
              <p className="muted">
                Odd cents from rounding go to the first{' '}
                {preview.result.remainderRecipients.length} participant
                {preview.result.remainderRecipients.length === 1 ? '' : 's'} — the same
                rule the server applies (SPEC §6, §8.8).
              </p>
            )}
          </div>
        )}

        {submitError !== null && (
          <p role="alert" className="form-error">
            {submitError}
          </p>
        )}

        <button type="submit" disabled={!canSubmit}>
          {submitting ? 'Saving…' : 'Save expense'}
        </button>
      </form>
    </main>
  )
}

// --- helpers ----------------------------------------------------------

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : 'Invalid split'
}

/**
 * Parse the per-participant input for every id with `parse`. Returns the parsed
 * values in id order, or `null` if any input is missing or `parse` throws —
 * i.e. "not ready to preview yet" rather than an error to shout about.
 */
function tryParseEach<T>(
  ids: readonly string[],
  values: Record<string, string>,
  parse: (raw: string) => T,
): { userId: string; value: T }[] | null {
  const out: { userId: string; value: T }[] = []
  for (const userId of ids) {
    const raw = values[userId]
    if (raw === undefined || raw.trim() === '') return null
    try {
      out.push({ userId, value: parse(raw) })
    } catch {
      return null
    }
  }
  return out
}
