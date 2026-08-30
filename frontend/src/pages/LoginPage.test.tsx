/**
 * The check SPEC §10.3 / Phase 10 step 3 asks for:
 *
 *   "entering a wrong password on the login page leaves the error message
 *    visible on that same page, rather than reloading it."
 *
 * If the global 401 interceptor ever stops exempting /api/auth/login, this
 * test fails: the wrong-password 401 would trigger a redirect and the error
 * would never render.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'

import { AuthProvider } from '../auth/AuthContext'
import { mockLocation } from '../test/mockLocation'
import { LoginPage } from './LoginPage'

function renderLoginAt() {
  return render(
    <MemoryRouter initialEntries={['/login']}>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/" element={<h1>Home — signed in</h1>} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  )
}

describe('LoginPage — wrong password', () => {
  let loc: ReturnType<typeof mockLocation>

  beforeEach(() => {
    localStorage.clear()
    loc = mockLocation('/login')
  })

  afterEach(() => {
    loc.restore()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('keeps the error visible on the login page and does not navigate away', async () => {
    // Backend returns 401 with the deliberately generic message (SPEC §10.4).
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ detail: 'Incorrect email or password' }), {
          status: 401,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    )

    const user = userEvent.setup()
    renderLoginAt()

    await user.type(screen.getByLabelText('อีเมล'), 'someone@example.com')
    await user.type(screen.getByLabelText('รหัสผ่าน'), 'wrong-password')
    await user.click(screen.getByRole('button', { name: 'เข้าสู่ระบบ' }))

    // The error is shown, on this page.
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Incorrect email or password',
    )
    // Still on the login page — not redirected to Home, not hard-reloaded.
    expect(screen.getByRole('heading', { name: 'เข้าสู่ระบบ' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: /signed in/i })).not.toBeInTheDocument()
    expect(loc.assign).not.toHaveBeenCalled()
  })

  it('renders the brand panel (wordmark, headline, description) as real DOM text', () => {
    renderLoginAt()
    expect(screen.getByText('แบ่งจ่าย')).toBeInTheDocument()
    expect(screen.getByText('แบ่งจ่ายให้ลงตัว')).toBeInTheDocument()
    expect(screen.getByText('ไม่ต้องคิดเลขเอง')).toBeInTheDocument()
    expect(
      screen.getByText(
        'บันทึกค่าใช้จ่ายกลุ่ม แบ่งยอดอัตโนมัติ และเคลียร์หนี้กันได้ง่าย ๆ',
      ),
    ).toBeInTheDocument()
  })

  it('a correct password navigates to the protected home route', async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString()
      if (url.endsWith('/api/auth/login')) {
        return Promise.resolve(
          new Response(JSON.stringify({ access_token: 'jwt-123', token_type: 'bearer' }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }),
        )
      }
      // /api/users/me
      return Promise.resolve(
        new Response(
          JSON.stringify({
            id: 'u1',
            email: 'someone@example.com',
            name: 'Somchai',
            created_at: '2026-08-29T00:00:00Z',
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      )
    })
    vi.stubGlobal('fetch', fetchMock)

    const user = userEvent.setup()
    renderLoginAt()

    await user.type(screen.getByLabelText('อีเมล'), 'someone@example.com')
    await user.type(screen.getByLabelText('รหัสผ่าน'), 'correct-horse')
    await user.click(screen.getByRole('button', { name: 'เข้าสู่ระบบ' }))

    expect(await screen.findByRole('heading', { name: /signed in/i })).toBeInTheDocument()
  })
})
