/**
 * GroupDetailPage — pending-member tag, the invite-member lookup/confirm flow
 * (Phase 14, SPEC §7.1), and expense delete / member removal (Phase 15).
 *
 *  - a PENDING member renders with the "pending" tag.
 *  - looking up an unknown email shows a calm inline message, not an error.
 *  - a looked-up user is only invited after an explicit confirm click: the
 *    lookup GET and the add-member POST are two separate, observably
 *    distinct calls, and the POST never fires on the lookup alone.
 *  - deleting an expense and removing a member both require the same
 *    inline confirm click; a single click never fires the request.
 *  - a 409 outstanding-balance response to member removal renders as a
 *    calm "notice", not a "form-error".
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'

import { GroupDetailPage } from './GroupDetailPage'

const GROUP = {
  id: 'g1',
  name: 'Trip',
  created_by_user_id: 'u1',
  created_at: '2026-01-01T00:00:00Z',
  members: [
    {
      user_id: 'u1',
      email: 'alice@x.com',
      name: 'Alice',
      joined_at: '2026-01-01T00:00:00Z',
      status: 'ACTIVE',
    },
    {
      user_id: 'u2',
      email: 'bob@x.com',
      name: 'Bob',
      joined_at: '2026-01-02T00:00:00Z',
      status: 'PENDING',
    },
  ],
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

interface Call {
  url: string
  method: string
}

function stubFetch(calls: Call[], overrides: (url: string, method: string) => Response | null) {
  const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString()
    const method = init?.method ?? 'GET'
    calls.push({ url, method })

    const overridden = overrides(url, method)
    if (overridden) return Promise.resolve(overridden)

    if (method === 'GET' && url.endsWith('/api/groups/g1')) {
      return Promise.resolve(jsonResponse(200, GROUP))
    }
    if (method === 'GET' && url.endsWith('/api/groups/g1/expenses')) {
      return Promise.resolve(jsonResponse(200, { items: [], total: 0, limit: 50, offset: 0 }))
    }
    return Promise.resolve(jsonResponse(404, { detail: `unexpected ${method} ${url}` }))
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/groups/g1']}>
      <Routes>
        <Route path="/groups/:groupId" element={<GroupDetailPage />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('GroupDetailPage', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('shows a pending tag next to a PENDING member', async () => {
    stubFetch([], () => null)

    renderPage()

    const bobRow = (await screen.findByText('Bob')).closest('li')
    expect(bobRow).not.toBeNull()
    expect(bobRow).toHaveTextContent('pending')

    const aliceRow = screen.getByText('Alice').closest('li')
    expect(aliceRow).not.toBeNull()
    expect(aliceRow).not.toHaveTextContent('pending')
  })

  it('shows a calm inline message when the looked-up email has no account', async () => {
    const calls: Call[] = []
    stubFetch(calls, (url, method) => {
      if (method === 'GET' && url.includes('/api/users/lookup')) {
        return jsonResponse(404, { detail: 'No user with that email' })
      }
      return null
    })

    const user = userEvent.setup()
    renderPage()

    await screen.findByText('Trip')
    await user.type(screen.getByLabelText('Email to invite'), 'nobody@example.com')
    await user.click(screen.getByRole('button', { name: /invite/i }))

    const notice = await screen.findByText('No account found with that email.')
    expect(notice).not.toHaveAttribute('role', 'alert')
    expect(notice.className).not.toContain('form-error')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('requires a confirm click before the add-member POST fires', async () => {
    const calls: Call[] = []
    stubFetch(calls, (url, method) => {
      if (method === 'GET' && url.includes('/api/users/lookup')) {
        return jsonResponse(200, { id: 'u3', email: 'jane@example.com', name: 'Jane Doe' })
      }
      if (method === 'POST' && url.endsWith('/api/groups/g1/members')) {
        return jsonResponse(201, {
          user_id: 'u3',
          email: 'jane@example.com',
          name: 'Jane Doe',
          joined_at: '2026-08-30T00:00:00Z',
          status: 'PENDING',
        })
      }
      return null
    })

    const user = userEvent.setup()
    renderPage()

    await screen.findByText('Trip')
    await user.type(screen.getByLabelText('Email to invite'), 'jane@example.com')
    await user.click(screen.getByRole('button', { name: /invite/i }))

    // Lookup happened; confirmation is shown; the invite POST has NOT fired yet.
    await screen.findByText('Invite Jane Doe (jane@example.com) to this group?')
    expect(
      calls.some((c) => c.method === 'POST' && c.url.endsWith('/api/groups/g1/members')),
    ).toBe(false)

    await user.click(screen.getByRole('button', { name: /confirm invite/i }))

    // Now the POST has fired, as a call distinct from the lookup GET.
    const lookupCalls = calls.filter(
      (c) => c.method === 'GET' && c.url.includes('/api/users/lookup'),
    )
    const postCalls = calls.filter(
      (c) => c.method === 'POST' && c.url.endsWith('/api/groups/g1/members'),
    )
    expect(lookupCalls).toHaveLength(1)
    expect(postCalls).toHaveLength(1)

    // The new PENDING member now shows in the list.
    const janeRow = (await screen.findByText('Jane Doe')).closest('li')
    expect(janeRow).toHaveTextContent('pending')
  })

  // --- delete expense (Phase 15) ------------------------------------------

  const EXPENSE = {
    id: 'e1',
    group_id: 'g1',
    paid_by_user_id: 'u1',
    amount: '20.00',
    description: 'Groceries',
    expense_date: '2026-08-20',
    split_type: 'EQUAL',
    created_at: '2026-08-20T00:00:00Z',
  }

  it('requires a confirm click before deleting an expense, then removes it', async () => {
    const calls: Call[] = []
    stubFetch(calls, (url, method) => {
      if (method === 'GET' && url.endsWith('/api/groups/g1/expenses')) {
        return jsonResponse(200, { items: [EXPENSE], total: 1, limit: 50, offset: 0 })
      }
      if (method === 'DELETE' && url.endsWith('/api/expenses/e1')) {
        return new Response(null, { status: 204 })
      }
      return null
    })

    const user = userEvent.setup()
    renderPage()

    await screen.findByText('Groceries')
    await user.click(screen.getByRole('button', { name: /^delete$/i }))

    // A single click does not delete -- the confirm step is required.
    expect(screen.getByText('Delete this expense?')).toBeInTheDocument()
    expect(calls.some((c) => c.method === 'DELETE')).toBe(false)
    expect(screen.getByText('Groceries')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /^confirm$/i }))

    expect(await screen.findByText('No expenses yet.')).toBeInTheDocument()
    expect(screen.queryByText('Groceries')).not.toBeInTheDocument()
    expect(calls.some((c) => c.method === 'DELETE' && c.url.endsWith('/api/expenses/e1'))).toBe(
      true,
    )
  })

  // --- remove member (Phase 15) -------------------------------------------

  it('a 409 outstanding-balance response shows a calm notice, not an error', async () => {
    const calls: Call[] = []
    stubFetch(calls, (url, method) => {
      if (method === 'DELETE' && url.endsWith('/api/groups/g1/members/u1')) {
        return jsonResponse(409, {
          detail: {
            message: 'Cannot remove a member with a non-zero balance',
            outstanding_balance: '-100.00',
          },
        })
      }
      return null
    })

    const user = userEvent.setup()
    renderPage()

    await screen.findByText('Alice')
    const aliceRow = screen.getByText('Alice').closest('li')
    expect(aliceRow).not.toBeNull()

    await user.click(within(aliceRow as HTMLElement).getByRole('button', { name: /^remove$/i }))
    await user.click(within(aliceRow as HTMLElement).getByRole('button', { name: /^confirm$/i }))

    const notice = await screen.findByText(/outstanding balance of ฿100\.00/)
    expect(notice.className).toContain('notice')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()

    // Alice was not removed.
    expect(screen.getByText('Alice')).toBeInTheDocument()
  })

  it('a 204 response removes the member from the list', async () => {
    const calls: Call[] = []
    stubFetch(calls, (url, method) => {
      if (method === 'DELETE' && url.endsWith('/api/groups/g1/members/u2')) {
        return new Response(null, { status: 204 })
      }
      return null
    })

    const user = userEvent.setup()
    renderPage()

    await screen.findByText('Bob')
    const bobRow = screen.getByText('Bob').closest('li')
    expect(bobRow).not.toBeNull()

    await user.click(within(bobRow as HTMLElement).getByRole('button', { name: /^remove$/i }))
    await user.click(within(bobRow as HTMLElement).getByRole('button', { name: /^confirm$/i }))

    await waitFor(() => expect(screen.queryByText('Bob')).not.toBeInTheDocument())
  })
})
