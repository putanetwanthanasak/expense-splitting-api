/**
 * RegisterPage — Phase 17 adds the real <AuthBrandPanel> element and Thai
 * copy. This covers that the brand wordmark and heading are real, queryable
 * DOM (not CSS generated content).
 */

import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

import { RegisterPage } from './RegisterPage'

vi.mock('../auth/auth-context', () => ({
  useAuth: () => ({
    user: null,
    loading: false,
    login: vi.fn(),
    register: vi.fn(),
    logout: vi.fn(),
  }),
}))

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/register']}>
      <RegisterPage />
    </MemoryRouter>,
  )
}

describe('RegisterPage', () => {
  it('renders the brand wordmark as real DOM text', () => {
    renderPage()
    expect(screen.getByText('แบ่งจ่าย')).toBeInTheDocument()
  })

  it('renders the Thai heading and form fields', () => {
    renderPage()
    expect(screen.getByRole('heading', { name: 'สร้างบัญชีใหม่' })).toBeInTheDocument()
    expect(screen.getByLabelText('ชื่อ')).toBeInTheDocument()
    expect(screen.getByLabelText('อีเมล')).toBeInTheDocument()
    expect(screen.getByLabelText('รหัสผ่าน')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'สร้างบัญชี' })).toBeInTheDocument()
  })
})
