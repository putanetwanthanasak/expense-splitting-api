/**
 * BalanceSummaryPage — the §14.4 readable-Thai rendering: a headline for the
 * viewer's own position, a per-person tree from the simplified transfers, and a
 * fully-settled empty state instead of a table of zeros.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'

import { BalanceSummaryPage } from './BalanceSummaryPage'

vi.mock('../auth/auth-context', () => ({
  useAuth: () => ({
    user: { id: 'u1', email: 'a@x.com', name: 'อลิซ', created_at: '2026-01-01T00:00:00Z' },
    loading: false,
    login: vi.fn(),
    register: vi.fn(),
    logout: vi.fn(),
  }),
}))

const members = [
  { user_id: 'u1', email: 'a@x.com', name: 'อลิซ', joined_at: '2026-01-01T00:00:00Z' },
  { user_id: 'u2', email: 'b@x.com', name: 'สมชาย', joined_at: '2026-01-01T00:00:00Z' },
  { user_id: 'u3', email: 'c@x.com', name: 'สมหญิง', joined_at: '2026-01-01T00:00:00Z' },
]

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function stub(balances: { user_id: string; net_balance: string }[], transfers: unknown[]) {
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
      if (url.endsWith('/api/groups/g1/balances')) {
        return Promise.resolve(jsonResponse(200, { balances }))
      }
      if (url.endsWith('/api/groups/g1/settle-up')) {
        return Promise.resolve(jsonResponse(200, { transfers, note: 'n' }))
      }
      return Promise.resolve(jsonResponse(404, { detail: `unexpected ${url}` }))
    }),
  )
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/groups/g1/balances']}>
      <Routes>
        <Route path="/groups/:groupId/balances" element={<BalanceSummaryPage />} />
        <Route path="/groups/:groupId" element={<div>group page</div>} />
      </Routes>
    </MemoryRouter>,
  )
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('BalanceSummaryPage', () => {
  beforeEach(() => localStorage.clear())

  it('renders the viewer position as Thai text with a per-debtor tree', async () => {
    stub(
      [
        { user_id: 'u1', net_balance: '250.00' },
        { user_id: 'u2', net_balance: '-150.00' },
        { user_id: 'u3', net_balance: '-100.00' },
      ],
      [
        { from_user_id: 'u2', to_user_id: 'u1', amount: '150.00' },
        { from_user_id: 'u3', to_user_id: 'u1', amount: '100.00' },
      ],
    )
    renderPage()

    const headline = await screen.findByText('คุณควรได้รับคืน ฿250.00')
    const summarySection = headline.closest('.balance-summary')
    expect(summarySection).not.toBeNull()
    expect(summarySection).toHaveTextContent('├─สมชาย ควรจ่ายคุณ ฿150.00')
    expect(summarySection).toHaveTextContent('└─สมหญิง ควรจ่ายคุณ ฿100.00')

    // per-member section
    expect(screen.getByText('อลิซ (คุณ) — ควรได้รับคืน ฿250.00')).toBeInTheDocument()
    expect(screen.getByText('สมชาย — ค้างชำระ ฿150.00')).toBeInTheDocument()
    expect(screen.getByText('สมหญิง — ค้างชำระ ฿100.00')).toBeInTheDocument()
  })

  it('shows a settled empty state when every balance is zero', async () => {
    stub(
      [
        { user_id: 'u1', net_balance: '0.00' },
        { user_id: 'u2', net_balance: '0.00' },
        { user_id: 'u3', net_balance: '0.00' },
      ],
      [],
    )
    renderPage()

    expect(
      await screen.findByText('กลุ่มนี้ชำระยอดครบแล้ว — ไม่มีใครเป็นหนี้ใคร'),
    ).toBeInTheDocument()
    expect(screen.queryByText(/ควรได้รับคืน/)).not.toBeInTheDocument()
  })
})
