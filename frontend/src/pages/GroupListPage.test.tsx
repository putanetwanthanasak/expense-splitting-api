/**
 * GroupListPage — each group carries the caller's own net position, green when
 * they're owed and red when they owe (SPEC §14). `net_balance` arrives as a
 * Decimal string and must go through `parseMoney` before it's shown.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

import { GroupListPage } from './GroupListPage'

vi.mock('../auth/auth-context', () => ({
  useAuth: () => ({
    user: { id: 'u1', email: 'alice@x.com', name: 'Alice', created_at: '2026-01-01T00:00:00Z' },
    loading: false,
    login: vi.fn(),
    register: vi.fn(),
    logout: vi.fn(),
  }),
}))

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

beforeEach(() => {
  localStorage.clear()
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString()

      if (url.endsWith('/api/groups')) {
        return Promise.resolve(
          jsonResponse(200, [
            { id: 'g1', name: 'Trip', created_by_user_id: 'u1', created_at: '2026-01-01T00:00:00Z' },
            { id: 'g2', name: 'Flat', created_by_user_id: 'u2', created_at: '2026-01-01T00:00:00Z' },
          ]),
        )
      }
      if (url.endsWith('/api/groups/g1/balances')) {
        return Promise.resolve(
          jsonResponse(200, {
            balances: [
              { user_id: 'u1', net_balance: '150.00' },
              { user_id: 'u2', net_balance: '-150.00' },
            ],
          }),
        )
      }
      if (url.endsWith('/api/groups/g2/balances')) {
        return Promise.resolve(
          jsonResponse(200, {
            balances: [
              { user_id: 'u1', net_balance: '-40.00' },
              { user_id: 'u2', net_balance: '40.00' },
            ],
          }),
        )
      }
      return Promise.resolve(jsonResponse(404, { detail: `unexpected ${url}` }))
    }),
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('GroupListPage', () => {
  it('renders the page subtitle as real DOM text', async () => {
    render(
      <MemoryRouter>
        <GroupListPage />
      </MemoryRouter>,
    )
    expect(
      await screen.findByText('ภาพรวมยอดคงเหลือของคุณในแต่ละกลุ่ม'),
    ).toBeInTheDocument()
  })

  it('shows each group with the caller net position, green for owed and red for owing', async () => {
    render(
      <MemoryRouter>
        <GroupListPage />
      </MemoryRouter>,
    )

    expect(await screen.findByText('Trip')).toBeInTheDocument()
    expect(screen.getByText('Flat')).toBeInTheDocument()

    const owed = screen.getByText('คุณควรได้รับคืน ฿150.00')
    expect(owed).toHaveClass('net-pos')

    const owing = screen.getByText('คุณติดหนี้ ฿40.00')
    expect(owing).toHaveClass('net-neg')
  })
})
