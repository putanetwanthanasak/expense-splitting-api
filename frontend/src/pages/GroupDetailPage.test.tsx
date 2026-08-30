/**
 * GroupDetailPage — pending-member tag, and the invite-member lookup/confirm
 * flow (Phase 14, SPEC §7.1).
 *
 *  - a PENDING member renders with the "pending" tag.
 *  - looking up an unknown email shows a calm inline message, not an error.
 *  - a looked-up user is only invited after an explicit confirm click: the
 *    lookup GET and the add-member POST are two separate, observably
 *    distinct calls, and the POST never fires on the lookup alone.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
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
})
