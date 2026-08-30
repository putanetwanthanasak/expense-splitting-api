/**
 * Sidebar (Phase 16) — the desktop nav shell.
 *
 * The pending-invitation count is a prop now (AppLayout owns the single fetch,
 * see usePendingInvitationCount.test.ts for the fetch behaviour), so these
 * tests just drive the badge via the prop — no `fetch` stubbing, no async.
 *
 * Covers:
 *   - brand, both nav items, and the signed-in user in the footer all render
 *     from real state (not placeholders);
 *   - the active nav item tracks the current route;
 *   - the "คำเชิญ" badge shows the exact `pendingCount` it is given (and
 *     nothing when that is 0) — it is not hardcoded.
 */

import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

import { Sidebar } from './Sidebar'

vi.mock('../auth/auth-context', () => ({
  useAuth: () => ({
    user: {
      id: 'u1',
      email: 'somchai@x.com',
      name: 'สมชาย ใจดี',
      created_at: '2026-01-01T00:00:00Z',
    },
    loading: false,
    login: vi.fn(),
    register: vi.fn(),
    logout: vi.fn(),
  }),
}))

function renderSidebar(path: string, pendingCount = 0) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Sidebar pendingCount={pendingCount} />
    </MemoryRouter>,
  )
}

describe('Sidebar', () => {
  it('renders the brand, both nav items, and the signed-in user', () => {
    renderSidebar('/')

    expect(screen.getByRole('link', { name: 'แบ่งจ่าย' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'กลุ่มของฉัน' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'คำเชิญ' })).toBeInTheDocument()
    // Footer shows the real authenticated user's name.
    expect(screen.getByText('สมชาย ใจดี')).toBeInTheDocument()
  })

  it('marks "กลุ่มของฉัน" active on the groups route', () => {
    renderSidebar('/')

    expect(screen.getByRole('link', { name: 'กลุ่มของฉัน' })).toHaveClass(
      'ds-navitem-active',
    )
    expect(screen.getByRole('link', { name: 'คำเชิญ' })).not.toHaveClass(
      'ds-navitem-active',
    )
  })

  it('marks "คำเชิญ" active on the invitations route', () => {
    renderSidebar('/invitations')

    expect(screen.getByRole('link', { name: 'คำเชิญ' })).toHaveClass(
      'ds-navitem-active',
    )
    expect(screen.getByRole('link', { name: 'กลุ่มของฉัน' })).not.toHaveClass(
      'ds-navitem-active',
    )
  })

  it('shows the pending-invitation count it is given on the badge', () => {
    renderSidebar('/', 3)

    const badge = screen.getByLabelText('คำเชิญที่รอตอบรับ 3 รายการ')
    expect(badge).toHaveTextContent('3')
    expect(badge).toHaveClass('ds-badge')
  })

  it('reflects a different count without any hardcoded value', () => {
    renderSidebar('/', 1)

    expect(screen.getByLabelText('คำเชิญที่รอตอบรับ 1 รายการ')).toHaveTextContent('1')
  })

  it('renders no badge when the count is 0', () => {
    renderSidebar('/', 0)

    expect(screen.queryByText(/รายการ$/)).not.toBeInTheDocument()
    expect(document.querySelector('.ds-badge')).toBeNull()
  })
})
