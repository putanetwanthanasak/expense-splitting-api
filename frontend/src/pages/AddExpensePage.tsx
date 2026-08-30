/**
 * AddExpensePage — record an expense, with the form reshaping itself around the
 * chosen split type (SPEC §14.1) and a live preview of the resulting split
 * before anything is saved (SPEC §14.2). Also does double duty as the edit
 * form (Phase 15): when the route carries an `expenseId`, the same form is
 * pre-filled from GET /api/expenses/:id and submits a PATCH instead of a
 * POST, with identical validation and preview either way.
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
import type { ExpenseCreateBody, ExpenseSplit, GroupMember, SplitType } from '../lib/api'
import { formatMoney, parseMoney, sumMoney, toApiString, ZERO } from '../lib/money'
import type { Money } from '../lib/money'
import {
  HUNDRED_PERCENT,
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

/** Thai labels for the split-type <select> options (values stay the enum). */
const SPLIT_TYPE_LABELS: Record<SplitType, string> = {
  EQUAL: 'เท่ากัน',
  EXACT: 'ระบุจำนวน',
  PERCENTAGE: 'เปอร์เซ็นต์',
  SHARES: 'สัดส่วน',
}

/** Per-participant input aria-label prefix, e.g. "จำนวนเงินของ Alice". */
const valueLabel: Record<SplitType, string> = {
  EQUAL: '',
  EXACT: 'จำนวนเงินของ',
  PERCENTAGE: 'เปอร์เซ็นต์ของ',
  SHARES: 'สัดส่วนของ',
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
  const { groupId, expenseId } = useParams<{ groupId: string; expenseId?: string }>()
  const navigate = useNavigate()
  const isEditing = expenseId !== undefined

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

    const load = async () => {
      const [detail, expense] = await Promise.all([
        groupsApi.get(id),
        expenseId ? expensesApi.get(expenseId) : Promise.resolve(null),
      ])
      if (cancelled) return

      // Only ACTIVE members can be a payer or participant (§7.1) -- a
      // PENDING invitee isn't a member yet and the backend rejects their id
      // as either with a 400, so they never appear in this picker.
      const active = detail.members.filter((m) => m.status === 'ACTIVE')
      setMembers(active)

      if (expense === null) {
        setSelected(Object.fromEntries(active.map((m) => [m.user_id, true] as const)))
        setPaidBy(active[0]?.user_id ?? '')
        return
      }

      // Pre-fill from the existing expense (edit mode).
      setDescription(expense.description)
      setAmountText(expense.amount)
      setDateText(expense.expense_date)
      setPaidBy(expense.paid_by_user_id)
      setSplitType(expense.split_type)

      const splitUserIds = new Set(expense.splits.map((s) => s.user_id))
      setSelected(
        Object.fromEntries(active.map((m) => [m.user_id, splitUserIds.has(m.user_id)] as const)),
      )

      if (expense.split_type === 'EXACT') {
        setValues(exactValuesFromSplits(expense.splits))
      } else if (expense.split_type === 'PERCENTAGE') {
        setValues(percentValuesFromSplits(expense.splits, parseMoney(expense.amount)))
      } else if (expense.split_type === 'SHARES') {
        setValues(shareValuesFromSplits(expense.splits))
      }
    }

    load().catch((err: unknown) => {
      if (cancelled) return
      setLoadError(
        err instanceof ApiError
          ? err.status === 403
            ? 'คุณไม่มีสิทธิ์เข้าถึงกลุ่มนี้'
            : err.detail
          : expenseId
            ? 'โหลดรายการนี้ไม่สำเร็จ'
            : 'โหลดข้อมูลกลุ่มไม่สำเร็จ',
      )
    })

    return () => {
      cancelled = true
    }
  }, [groupId, expenseId])

  const nameOf = (userId: string): string =>
    members?.find((m) => m.user_id === userId)?.name ?? 'ไม่ทราบชื่อ'

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
          ? `— จาก ${formatMoney(amount)}`
          : `${formatMoney(running)} จาก ${formatMoney(amount)}`
      if (parsed === null) {
        return {
          result: null,
          hint: 'กรอกจำนวนเงินให้ครบทุกคนที่เลือกไว้',
          runningTotal,
        }
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
        runningPct === null
          ? '—% จาก 100%'
          : `${toPercentApiString(runningPct)}% จาก 100%`
      if (parsed === null) {
        return {
          result: null,
          hint: 'กรอกเปอร์เซ็นต์ให้ครบทุกคนที่เลือกไว้',
          runningTotal,
        }
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
        hint: 'กรอกจำนวนส่วนแบบเต็มจำนวนให้ครบทุกคนที่เลือกไว้',
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
      if (isEditing && expenseId) {
        await expensesApi.update(expenseId, body)
      } else {
        await expensesApi.create(groupId, body)
      }
      navigate(`/groups/${groupId}`, { replace: true })
    } catch (err) {
      setSubmitError(err instanceof ApiError ? err.detail : 'บันทึกรายการไม่สำเร็จ')
      setSubmitting(false)
    }
  }

  if (loadError !== null) {
    return (
      <main className="page add-expense-page">
        <p>
          <Link to={groupId ? `/groups/${groupId}` : '/'}>← กลับ</Link>
        </p>
        <p role="alert" className="form-error">
          {loadError}
        </p>
      </main>
    )
  }

  if (members === null) {
    return (
      <main className="page add-expense-page">
        <p className="centered-status">กำลังโหลด…</p>
      </main>
    )
  }

  return (
    <main className="page add-expense-page">
      <p>
        <Link to={`/groups/${groupId}`}>← กลับไปที่กลุ่ม</Link>
      </p>
      <h1>{isEditing ? 'แก้ไขรายการ' : 'เพิ่มรายการใช้จ่าย'}</h1>

      <form className="expense-form" onSubmit={onSubmit} noValidate>
        <label>
          รายละเอียด
          <input
            name="description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            required
          />
        </label>

        <label>
          จำนวนเงิน
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
          <p className="split-hint">กรอกจำนวนเงิน เช่น 42.50</p>
        )}

        <label>
          วันที่
          <input
            type="date"
            name="expense_date"
            value={dateText}
            onChange={(e) => setDateText(e.target.value)}
            required
          />
        </label>

        <label>
          ผู้จ่าย
          <select value={paidBy} onChange={(e) => setPaidBy(e.target.value)}>
            {members.map((m) => (
              <option key={m.user_id} value={m.user_id}>
                {m.name}
              </option>
            ))}
          </select>
        </label>

        <label>
          วิธีแบ่ง
          <select
            value={splitType}
            onChange={(e) => changeSplitType(e.target.value as SplitType)}
          >
            {SPLIT_TYPES.map((t) => (
              <option key={t} value={t}>
                {SPLIT_TYPE_LABELS[t]}
              </option>
            ))}
          </select>
        </label>

        <fieldset className="participants">
          <legend>ผู้ร่วมจ่าย</legend>
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
                    aria-label={`${valueLabel[splitType]} ${m.name}`}
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
            ยอดรวมที่กรอก: {preview.runningTotal}
          </p>
        )}

        {preview.hint !== null && <p className="split-hint">{preview.hint}</p>}

        {preview.result !== null && (
          <div className="preview">
            <h2>ตัวอย่างการแบ่ง</h2>
            <ul>
              {participantIds.map((id) => {
                const share = preview.result?.shares.get(id) ?? ZERO
                const getsExtra = preview.result?.remainderRecipients.includes(id) ?? false
                return (
                  <li key={id}>
                    {nameOf(id)}: {formatMoney(share)}
                    {getsExtra && (
                      <span className="remainder"> (+{formatMoney(ONE_CENT)} เศษสตางค์)</span>
                    )}
                  </li>
                )
              })}
            </ul>
            {preview.result.remainderRecipients.length > 0 && (
              <p className="muted">
                เศษสตางค์จากการปัดเศษจะตกกับผู้ร่วมจ่าย{' '}
                {preview.result.remainderRecipients.length} คนแรก —
                เป็นกฎเดียวกับที่เซิร์ฟเวอร์ใช้ (SPEC §6, §8.8)
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
          {submitting ? 'กำลังบันทึก…' : isEditing ? 'บันทึกการแก้ไข' : 'บันทึกรายการ'}
        </button>
      </form>
    </main>
  )
}

// --- helpers ----------------------------------------------------------

/**
 * Turn an error thrown by split.ts into a Thai hint for the live preview.
 *
 * split.ts is a pure module with its own tests and is deliberately left
 * untranslated, so its `Error.message`s are English. Map the shapes the
 * preview can actually surface — an unbalanced EXACT or PERCENTAGE split, and
 * a couple of guard failures — to Thai here, in the display layer only.
 * Matching is on stable fragments, not whole sentences, and the exact figures
 * already show in the red "ยอดรวมที่กรอก" line just above, so the wording here
 * doesn't repeat them. Anything unrecognised falls through to the raw message
 * (or a generic Thai line for a non-Error) so a future wording change in
 * split.ts still shows something meaningful rather than a blank hint.
 */
function messageOf(err: unknown): string {
  if (!(err instanceof Error)) return 'การแบ่งไม่ถูกต้อง'
  const msg = err.message

  if (/sum to .* does not match the .* total/i.test(msg)) {
    return 'ยอดที่ระบุของแต่ละคนรวมกันยังไม่ตรงกับยอดค่าใช้จ่าย'
  }
  if (/percentages sum to .* does not equal 100/i.test(msg)) {
    return 'เปอร์เซ็นต์ของแต่ละคนรวมกันยังไม่เท่ากับ 100%'
  }
  if (/requires at least one participant/i.test(msg)) {
    return 'ต้องเลือกผู้ร่วมจ่ายอย่างน้อยหนึ่งคน'
  }
  if (/must be unique/i.test(msg)) {
    return 'ผู้ร่วมจ่ายต้องไม่ซ้ำกัน'
  }
  if (/must be a whole number/i.test(msg)) {
    return 'จำนวนส่วนของแต่ละคนต้องเป็นจำนวนเต็มที่มากกว่า 0'
  }
  return msg
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

// --- Edit mode: reconstruct per-split-type inputs from a saved expense ----
//
// GET /api/expenses/:id only ever returns each split's `amount_owed` — the
// backend never stores the percentages or share counts a group originally
// typed (§9: a PATCH deletes and recomputes every split from scratch). These
// three helpers turn that `amount_owed` list back into the per-participant
// text inputs this form edits, close enough to reproduce the same split by
// default; the user can still change any of them before saving.

/** EXACT: `amount_owed` *is* the amount, verbatim. */
function exactValuesFromSplits(splits: readonly ExpenseSplit[]): Record<string, string> {
  return Object.fromEntries(splits.map((s) => [s.user_id, s.amount_owed]))
}

/**
 * SHARES: each split's amount-owed cents, used directly as the share weight,
 * reproduces the exact original split with zero remainder — every
 * `amount_owed` already sums to the expense total, so
 * `floor(total * amount_i / total) === amount_i` for each participant. Not
 * the share counts the group actually typed (never stored), but a share
 * input that recreates the same split.
 */
function shareValuesFromSplits(splits: readonly ExpenseSplit[]): Record<string, string> {
  return Object.fromEntries(splits.map((s) => [s.user_id, `${parseMoney(s.amount_owed)}`]))
}

/**
 * PERCENTAGE: each participant's percentage is derived from their share of
 * the total, floored to hundredths of a percent, with the leftover
 * hundredths handed to the first participants in split order — the same
 * largest-remainder shape `split.ts` itself uses — so the reconstructed
 * percentages always sum to exactly 100, never drift from rounding.
 */
function percentValuesFromSplits(
  splits: readonly ExpenseSplit[],
  total: Money,
): Record<string, string> {
  const order = splits.map((s) => s.user_id)
  const floored = new Map<string, number>(
    splits.map((s) => {
      const cents = parseMoney(s.amount_owed)
      return [s.user_id, Math.floor((cents * HUNDRED_PERCENT) / total)] as const
    }),
  )
  let assigned = 0
  for (const v of floored.values()) assigned += v
  const leftover = HUNDRED_PERCENT - assigned

  const values: Record<string, string> = {}
  order.forEach((id, index) => {
    const percent = ((floored.get(id) ?? 0) + (index < leftover ? 1 : 0)) as Percent
    values[id] = toPercentApiString(percent)
  })
  return values
}
