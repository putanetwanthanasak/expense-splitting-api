/**
 * InvitationsPage — accept removes + navigates, decline removes + stays, empty
 * state renders (Phase 14, SPEC §7.1).
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'

import { InvitationsPage } from './InvitationsPage'

const ONE_INVITE = [
  { group_id: 'g1', group_name: 'Trip', invited_at: '2026-08-01T00:00:00Z' },
]

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/invitations']}>
      <Routes>
        <Route path="/invitations" element={<InvitationsPage />} />
        <Route path="/groups/:groupId" element={<div>Group g1 detail</div>} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('InvitationsPage', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('renders a calm empty state when there are no pending invitations', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(200, [])))

    renderPage()

    expect(await screen.findByText('No pending invitations.')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('accept removes the invitation from the list and navigates to the group', async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString()
      const method = init?.method ?? 'GET'
      if (method === 'GET' && url.endsWith('/api/me/invitations')) {
        return Promise.resolve(jsonResponse(200, ONE_INVITE))
      }
      if (method === 'POST' && url.endsWith('/api/groups/g1/members/me/accept')) {
        return Promise.resolve(
          jsonResponse(200, {
            user_id: 'u2',
            email: 'bob@x.com',
            name: 'Bob',
            joined_at: '2026-08-30T00:00:00Z',
            status: 'ACTIVE',
          }),
        )
      }
      return Promise.resolve(jsonResponse(404, { detail: `unexpected ${method} ${url}` }))
    })
    vi.stubGlobal('fetch', fetchMock)

    const user = userEvent.setup()
    renderPage()

    await screen.findByText('Trip')
    await user.click(screen.getByRole('button', { name: /accept/i }))

    expect(await screen.findByText('Group g1 detail')).toBeInTheDocument()
    expect(screen.queryByText('Trip')).not.toBeInTheDocument()
  })

  it('decline removes the invitation from the list and stays on the page', async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString()
      const method = init?.method ?? 'GET'
      if (method === 'GET' && url.endsWith('/api/me/invitations')) {
        return Promise.resolve(jsonResponse(200, ONE_INVITE))
      }
      if (method === 'POST' && url.endsWith('/api/groups/g1/members/me/decline')) {
        return Promise.resolve(new Response(null, { status: 204 }))
      }
      return Promise.resolve(jsonResponse(404, { detail: `unexpected ${method} ${url}` }))
    })
    vi.stubGlobal('fetch', fetchMock)

    const user = userEvent.setup()
    renderPage()

    await screen.findByText('Trip')
    await user.click(screen.getByRole('button', { name: /decline/i }))

    expect(await screen.findByText('No pending invitations.')).toBeInTheDocument()
    expect(screen.queryByText('Group g1 detail')).not.toBeInTheDocument()
  })
})
