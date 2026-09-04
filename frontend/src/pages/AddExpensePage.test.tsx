/**
 * AddExpensePage — the split-type-driven form and the live preview (§14.1, §14.2).
 *
 * The load-bearing checks:
 *  - EQUAL preview shows the largest-remainder split (100/3 -> 33.34/33.33/33.33)
 *    and names who gets the extra cent, matching split.ts / the backend (§6).
 *  - EXACT keeps "Save expense" disabled until the per-person amounts add up to
 *    the expense amount (§14.1).
 *  - a submitted EQUAL expense posts the discriminated body the backend expects
 *    and returns to the group.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'

import { AddExpensePage } from './AddExpensePage'

const members = [
  {
    user_id: 'u1',
    email: 'alice@x.com',
    name: 'Alice',
    joined_at: '2026-01-01T00:00:00Z',
    status: 'ACTIVE' as const,
  },
  {
    user_id: 'u2',
    email: 'bob@x.com',
    name: 'Bob',
    joined_at: '2026-01-01T00:00:00Z',
    status: 'ACTIVE' as const,
  },
  {
    user_id: 'u3',
    email: 'carol@x.com',
    name: 'Carol',
    joined_at: '2026-01-01T00:00:00Z',
    status: 'ACTIVE' as const,
  },
]

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

interface Call {
  url: string
  method: string
  body: string | null
}

function stubFetch(calls: Call[]) {
  const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString()
    const method = init?.method ?? 'GET'
    calls.push({ url, method, body: typeof init?.body === 'string' ? init.body : null })

    if (method === 'GET' && url.endsWith('/api/groups/g1')) {
      return Promise.resolve(
        jsonResponse(200, {
          id: 'g1',
          name: 'Trip',
          created_by_user_id: 'u1',
          created_at: '2026-01-01T00:00:00Z',
          members,
        }),
      )
    }
    if (method === 'POST' && url.endsWith('/api/groups/g1/expenses')) {
      return Promise.resolve(
        jsonResponse(201, {
          id: 'e1',
          group_id: 'g1',
          paid_by_user_id: 'u1',
          amount: '100.00',
          description: 'Dinner',
          expense_date: '2026-08-29',
          split_type: 'EQUAL',
          created_at: '2026-08-29T00:00:00Z',
          splits: [],
        }),
      )
    }
    return Promise.resolve(jsonResponse(404, { detail: `unexpected ${method} ${url}` }))
  })
  vi.stubGlobal('fetch', fetchMock)
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/groups/g1/expenses/new']}>
      <Routes>
        <Route path="/groups/:groupId/expenses/new" element={<AddExpensePage />} />
        <Route path="/groups/:groupId" element={<div>Group g1 detail</div>} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('AddExpensePage', () => {
  let calls: Call[]

  beforeEach(() => {
    calls = []
    stubFetch(calls)
    localStorage.clear()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('previews the EQUAL split and marks who receives the extra cent', async () => {
    const user = userEvent.setup()
    renderPage()

    await screen.findByRole('heading', { name: 'เพิ่มรายการใช้จ่าย' })
    await user.type(screen.getByLabelText('รายละเอียด'), 'Dinner')
    await user.type(screen.getByLabelText('จำนวนเงิน'), '100')

    const preview = screen.getByRole('heading', { name: 'ตัวอย่างการแบ่ง' }).closest('.preview')
    expect(preview).not.toBeNull()
    // name and amount are two separate spans (Thai name / numeral amount), not
    // one "Alice: ฿33.34" string.
    const p = within(preview as HTMLElement)
    expect(p.getByText('Alice')).toHaveClass('preview-name')
    expect(p.getByText('฿33.34')).toHaveClass('preview-amount')
    expect(p.getByText('+฿0.01 เศษสตางค์')).toHaveClass('remainder')
    expect(p.getByText('Bob')).toHaveClass('preview-name')
    expect(p.getByText('Carol')).toHaveClass('preview-name')
    expect(p.getAllByText('฿33.33')).toHaveLength(2)

    expect(screen.getByRole('button', { name: 'บันทึกรายการ' })).toBeEnabled()
  })

  it('EXACT: keeps Save disabled until the per-person amounts equal the total', async () => {
    const user = userEvent.setup()
    renderPage()

    await screen.findByRole('heading', { name: 'เพิ่มรายการใช้จ่าย' })
    await user.type(screen.getByLabelText('รายละเอียด'), 'Lunch')
    await user.type(screen.getByLabelText('จำนวนเงิน'), '100')
    await user.selectOptions(screen.getByLabelText('วิธีแบ่ง'), 'EXACT')

    await user.type(screen.getByLabelText('จำนวนเงินของ Alice'), '40')
    await user.type(screen.getByLabelText('จำนวนเงินของ Bob'), '30')
    await user.type(screen.getByLabelText('จำนวนเงินของ Carol'), '30')

    // §B fix (§ Add Expense investigation, item 1): label/amount now split
    // across spans (see AddExpensePage.tsx), so this queries the containing
    // <p> rather than an exact single-node text match.
    expect(screen.getByText('ยอดรวมที่กรอก:').closest('p')).toHaveTextContent(
      'ยอดรวมที่กรอก: ฿100.00 จาก ฿100.00',
    )
    expect(screen.getByRole('button', { name: 'บันทึกรายการ' })).toBeEnabled()

    await user.clear(screen.getByLabelText('จำนวนเงินของ Carol'))
    await user.type(screen.getByLabelText('จำนวนเงินของ Carol'), '20')

    expect(screen.getByText('ยอดรวมที่กรอก:').closest('p')).toHaveTextContent(
      'ยอดรวมที่กรอก: ฿90.00 จาก ฿100.00',
    )
    // §Add Expense investigation, item 5: both the default and imbalanced
    // labels render (CSS toggles which one shows per breakpoint), so this
    // queries the button itself rather than an exact accessible-name match.
    const submitButton = document.querySelector('button[type="submit"]')
    expect(submitButton).toHaveTextContent('Balance amounts to add expense')
    expect(submitButton).toBeDisabled()

    // The split.ts mismatch hint is shown in Thai, not the raw English message.
    expect(
      screen.getByText('ยอดที่ระบุของแต่ละคนรวมกันยังไม่ตรงกับยอดค่าใช้จ่าย'),
    ).toBeInTheDocument()
    expect(screen.queryByText(/cents/)).not.toBeInTheDocument()
  })

  it('SHARES: previews the 2:1:1 split, flags a zero share in Thai, and submits the SHARES body', async () => {
    const user = userEvent.setup()
    renderPage()

    await screen.findByRole('heading', { name: 'เพิ่มรายการใช้จ่าย' })
    await user.type(screen.getByLabelText('รายละเอียด'), 'Petrol')
    await user.type(screen.getByLabelText('จำนวนเงิน'), '100')
    await user.selectOptions(screen.getByLabelText('วิธีแบ่ง'), 'SHARES')

    await user.type(screen.getByLabelText('สัดส่วนของ Alice'), '2')
    await user.type(screen.getByLabelText('สัดส่วนของ Bob'), '1')
    await user.type(screen.getByLabelText('สัดส่วนของ Carol'), '1')

    // Live preview: 2:1:1 of ฿100.00 -> largest-remainder ฿50 / ฿25 / ฿25, no odd cent.
    const preview = screen.getByRole('heading', { name: 'ตัวอย่างการแบ่ง' }).closest('.preview')
    expect(preview).not.toBeNull()
    const p = within(preview as HTMLElement)
    expect(p.getByText('Alice')).toHaveClass('preview-name')
    expect(p.getByText('฿50.00')).toHaveClass('preview-amount')
    expect(p.getAllByText('฿25.00')).toHaveLength(2)
    expect(preview).not.toHaveTextContent('เศษสตางค์')
    expect(screen.getByRole('button', { name: 'บันทึกรายการ' })).toBeEnabled()

    // A zero share -> the Thai message from messageOf(), never the raw English
    // "must be a whole number > 0" from split.ts; preview + Save are withdrawn.
    await user.clear(screen.getByLabelText('สัดส่วนของ Bob'))
    await user.type(screen.getByLabelText('สัดส่วนของ Bob'), '0')
    expect(
      screen.getByText('จำนวนส่วนของแต่ละคนต้องเป็นจำนวนเต็มที่มากกว่า 0'),
    ).toBeInTheDocument()
    expect(screen.queryByText(/whole number/i)).not.toBeInTheDocument()
    expect(
      screen.queryByRole('heading', { name: 'ตัวอย่างการแบ่ง' }),
    ).not.toBeInTheDocument()
    // §Add Expense investigation, item 5: both labels render, CSS toggles
    // which one shows per breakpoint -- query the button directly.
    const submitButton = document.querySelector('button[type="submit"]')
    expect(submitButton).toHaveTextContent('Balance amounts to add expense')
    expect(submitButton).toBeDisabled()

    // Restore a valid share and submit -> SHARES discriminated body.
    await user.clear(screen.getByLabelText('สัดส่วนของ Bob'))
    await user.type(screen.getByLabelText('สัดส่วนของ Bob'), '1')
    await user.click(screen.getByRole('button', { name: 'บันทึกรายการ' }))

    expect(await screen.findByText('Group g1 detail')).toBeInTheDocument()

    const post = calls.find((c) => c.method === 'POST')
    expect(post).toBeTruthy()
    expect(JSON.parse(post!.body as string)).toMatchObject({
      split_type: 'SHARES',
      amount: '100.00',
      description: 'Petrol',
      paid_by_user_id: 'u1',
      splits: [
        { user_id: 'u1', shares: '2' },
        { user_id: 'u2', shares: '1' },
        { user_id: 'u3', shares: '1' },
      ],
    })
  })

  it('renders the split-type options with Thai labels (real DOM, not CSS)', async () => {
    renderPage()

    await screen.findByRole('heading', { name: 'เพิ่มรายการใช้จ่าย' })
    const select = screen.getByLabelText('วิธีแบ่ง')
    // The <option> values stay the enum; only the visible text is Thai.
    expect(within(select).getByRole('option', { name: 'เท่ากัน' })).toHaveValue('EQUAL')
    expect(within(select).getByRole('option', { name: 'ระบุจำนวน' })).toHaveValue('EXACT')
    expect(within(select).getByRole('option', { name: 'เปอร์เซ็นต์' })).toHaveValue(
      'PERCENTAGE',
    )
    expect(within(select).getByRole('option', { name: 'สัดส่วน' })).toHaveValue('SHARES')
  })

  it('submits the EQUAL discriminated body and returns to the group', async () => {
    const user = userEvent.setup()
    renderPage()

    await screen.findByRole('heading', { name: 'เพิ่มรายการใช้จ่าย' })
    await user.type(screen.getByLabelText('รายละเอียด'), 'Dinner')
    await user.type(screen.getByLabelText('จำนวนเงิน'), '100')
    await user.click(screen.getByRole('button', { name: 'บันทึกรายการ' }))

    expect(await screen.findByText('Group g1 detail')).toBeInTheDocument()

    const post = calls.find((c) => c.method === 'POST')
    expect(post).toBeTruthy()
    expect(JSON.parse(post!.body as string)).toMatchObject({
      split_type: 'EQUAL',
      amount: '100.00',
      description: 'Dinner',
      paid_by_user_id: 'u1',
      participant_user_ids: ['u1', 'u2', 'u3'],
    })
  })
})

// --- edit mode (Phase 15) ---------------------------------------------

const EXISTING_EXPENSE = {
  id: 'e1',
  group_id: 'g1',
  paid_by_user_id: 'u1',
  amount: '100.00',
  description: 'Dinner',
  expense_date: '2026-08-14',
  split_type: 'EQUAL',
  created_at: '2026-08-14T00:00:00Z',
  splits: [
    { user_id: 'u1', amount_owed: '33.34' },
    { user_id: 'u2', amount_owed: '33.33' },
    { user_id: 'u3', amount_owed: '33.33' },
  ],
}

function stubEditFetch(calls: Call[]) {
  const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString()
    const method = init?.method ?? 'GET'
    calls.push({ url, method, body: typeof init?.body === 'string' ? init.body : null })

    if (method === 'GET' && url.endsWith('/api/groups/g1')) {
      return Promise.resolve(
        jsonResponse(200, {
          id: 'g1',
          name: 'Trip',
          created_by_user_id: 'u1',
          created_at: '2026-01-01T00:00:00Z',
          members,
        }),
      )
    }
    if (method === 'GET' && url.endsWith('/api/expenses/e1')) {
      return Promise.resolve(jsonResponse(200, EXISTING_EXPENSE))
    }
    if (method === 'PATCH' && url.endsWith('/api/expenses/e1')) {
      return Promise.resolve(jsonResponse(200, { ...EXISTING_EXPENSE, description: 'Dinner (edited)' }))
    }
    return Promise.resolve(jsonResponse(404, { detail: `unexpected ${method} ${url}` }))
  })
  vi.stubGlobal('fetch', fetchMock)
}

function renderEditPage() {
  return render(
    <MemoryRouter initialEntries={['/groups/g1/expenses/e1/edit']}>
      <Routes>
        <Route path="/groups/:groupId/expenses/:expenseId/edit" element={<AddExpensePage />} />
        <Route path="/groups/:groupId" element={<div>Group g1 detail</div>} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('AddExpensePage — edit mode', () => {
  let calls: Call[]

  beforeEach(() => {
    calls = []
    stubEditFetch(calls)
    localStorage.clear()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('pre-fills the form from GET /api/expenses/:id and submits a PATCH', async () => {
    const user = userEvent.setup()
    renderEditPage()

    await screen.findByRole('heading', { name: 'แก้ไขรายการ' })

    expect(screen.getByLabelText('รายละเอียด')).toHaveValue('Dinner')
    expect(screen.getByLabelText('จำนวนเงิน')).toHaveValue('100.00')
    expect(screen.getByLabelText('วันที่')).toHaveValue('2026-08-14')
    expect(screen.getByLabelText('ผู้จ่าย')).toHaveValue('u1')
    expect(screen.getByLabelText('วิธีแบ่ง')).toHaveValue('EQUAL')
    expect(screen.getByRole('checkbox', { name: /Alice/ })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: /Bob/ })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: /Carol/ })).toBeChecked()

    const saveButton = screen.getByRole('button', { name: 'บันทึกการแก้ไข' })
    expect(saveButton).toBeEnabled()

    await user.clear(screen.getByLabelText('รายละเอียด'))
    await user.type(screen.getByLabelText('รายละเอียด'), 'Dinner (edited)')
    await user.click(saveButton)

    expect(await screen.findByText('Group g1 detail')).toBeInTheDocument()

    const patch = calls.find((c) => c.method === 'PATCH')
    expect(patch).toBeTruthy()
    expect(patch!.url).toContain('/api/expenses/e1')
    expect(JSON.parse(patch!.body as string)).toMatchObject({
      split_type: 'EQUAL',
      amount: '100.00',
      description: 'Dinner (edited)',
      paid_by_user_id: 'u1',
      participant_user_ids: ['u1', 'u2', 'u3'],
    })

    // The create endpoint was never hit for an edit.
    expect(calls.some((c) => c.method === 'POST')).toBe(false)
  })
})
