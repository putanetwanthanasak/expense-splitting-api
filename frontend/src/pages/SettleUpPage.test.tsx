/**
 * SettleUpPage — the simplified transfer list, "mark as paid", the verbatim
 * note (§5), settlement history, and the fully-settled empty state (§14.4).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'

import { SettleUpPage } from './SettleUpPage'

const NOTE =
  'Simplified using greedy matching; guarantees at most N-1 transfers, not a proven minimum.'

const members = [
  {
    user_id: 'u1',
    email: 'a@x.com',
    name: 'Alice',
    joined_at: '2026-01-01T00:00:00Z',
    status: 'ACTIVE' as const,
  },
  {
    user_id: 'u2',
    email: 'b@x.com',
    name: 'Bob',
    joined_at: '2026-01-01T00:00:00Z',
    status: 'ACTIVE' as const,
  },
  {
    user_id: 'u3',
    email: 'c@x.com',
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

interface Post {
  body: string
}

/**
 * Stateful mock: the first `/settle-up` has two transfers; once a settlement is
 * POSTed, `/settle-up` drops to one and `/settlements` returns the record.
 */
function stubFetch(posts: Post[]) {
  const group = {
    id: 'g1',
    name: 'Trip',
    created_by_user_id: 'u1',
    created_at: '2026-01-01T00:00:00Z',
    members,
  }
  const allTransfers = [
    { from_user_id: 'u2', to_user_id: 'u1', amount: '100.00' },
    { from_user_id: 'u3', to_user_id: 'u1', amount: '50.00' },
  ]

  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString()
      const method = init?.method ?? 'GET'

      if (method === 'GET' && url.endsWith('/api/groups/g1')) {
        return Promise.resolve(jsonResponse(200, group))
      }
      if (method === 'GET' && url.endsWith('/api/groups/g1/settle-up')) {
        const transfers = posts.length === 0 ? allTransfers : allTransfers.slice(1)
        return Promise.resolve(jsonResponse(200, { transfers, note: NOTE }))
      }
      if (method === 'GET' && url.endsWith('/api/groups/g1/settlements')) {
        const history =
          posts.length === 0
            ? []
            : [
                {
                  id: 's1',
                  group_id: 'g1',
                  from_user_id: 'u2',
                  to_user_id: 'u1',
                  amount: '100.00',
                  settled_at: '2026-08-29T10:00:00Z',
                },
              ]
        return Promise.resolve(jsonResponse(200, history))
      }
      if (method === 'POST' && url.endsWith('/api/groups/g1/settlements')) {
        posts.push({ body: typeof init?.body === 'string' ? init.body : '' })
        return Promise.resolve(
          jsonResponse(201, {
            id: 's1',
            group_id: 'g1',
            from_user_id: 'u2',
            to_user_id: 'u1',
            amount: '100.00',
            settled_at: '2026-08-29T10:00:00Z',
            warning: null,
          }),
        )
      }
      return Promise.resolve(jsonResponse(404, { detail: `unexpected ${method} ${url}` }))
    }),
  )
}

function stubFetchSettled() {
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString()
      if (url.endsWith('/api/groups/g1')) {
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
      if (url.endsWith('/api/groups/g1/settle-up')) {
        return Promise.resolve(jsonResponse(200, { transfers: [], note: NOTE }))
      }
      if (url.endsWith('/api/groups/g1/settlements')) {
        return Promise.resolve(jsonResponse(200, []))
      }
      return Promise.resolve(jsonResponse(404, { detail: `unexpected ${url}` }))
    }),
  )
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/groups/g1/settle']}>
      <Routes>
        <Route path="/groups/:groupId/settle" element={<SettleUpPage />} />
        <Route path="/groups/:groupId" element={<div>group page</div>} />
      </Routes>
    </MemoryRouter>,
  )
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('SettleUpPage', () => {
  beforeEach(() => localStorage.clear())

  it('lists transfers with the verbatim note and a reduction disclaimer', async () => {
    stubFetch([])
    renderPage()

    expect(await screen.findByText(NOTE)).toBeInTheDocument()
    expect(screen.getByText(/ลดจำนวนครั้งของการโอน/)).toBeInTheDocument()
    expect(
      screen.getAllByRole('button', { name: 'ทำเครื่องหมายว่าชำระแล้ว' }),
    ).toHaveLength(2)
  })

  it('mark as paid POSTs the transfer and refetches', async () => {
    const posts: Post[] = []
    stubFetch(posts)
    const user = userEvent.setup()
    renderPage()

    const buttons = await screen.findAllByRole('button', {
      name: 'ทำเครื่องหมายว่าชำระแล้ว',
    })
    await user.click(buttons[0])

    await waitFor(() =>
      expect(
        screen.getAllByRole('button', { name: 'ทำเครื่องหมายว่าชำระแล้ว' }),
      ).toHaveLength(1),
    )

    expect(posts).toHaveLength(1)
    expect(JSON.parse(posts[0].body)).toEqual({
      from_user_id: 'u2',
      to_user_id: 'u1',
      amount: '100.00',
    })

    // history now shows the recorded settlement
    expect(screen.getByText(/Bob จ่าย Alice/)).toBeInTheDocument()
  })

  it('shows an empty state, not an empty table, when the group is fully settled', async () => {
    stubFetchSettled()
    renderPage()

    expect(
      await screen.findByText('กลุ่มนี้ชำระยอดครบแล้ว — ไม่มีรายการที่ต้องชำระ'),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'ทำเครื่องหมายว่าชำระแล้ว' }),
    ).not.toBeInTheDocument()
    expect(screen.queryByText(NOTE)).not.toBeInTheDocument()
    expect(screen.getByText('ยังไม่มีประวัติการชำระเงิน')).toBeInTheDocument()
  })
})
