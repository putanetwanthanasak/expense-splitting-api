import { useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'

import { useAuth } from '../auth/auth-context'
import { AuthBrandPanel } from '../components/AuthBrandPanel'
import { ApiError } from '../lib/api'

interface FromState {
  from?: { pathname?: string }
}

export function LoginPage() {
  const { login } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const redirectTo = (location.state as FromState | null)?.from?.pathname ?? '/'

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      await login(email, password)
      navigate(redirectTo, { replace: true })
    } catch (err) {
      // A wrong password (or unknown email) comes back as 401. Because
      // /api/auth/login is exempt from the interceptor (SPEC §10.3), that 401
      // lands here instead of redirecting — so we render it on THIS page and
      // the user actually sees what went wrong.
      setError(
        err instanceof ApiError
          ? err.detail
          : 'เข้าสู่ระบบไม่สำเร็จ กรุณาลองใหม่อีกครั้ง',
      )
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <>
      <AuthBrandPanel />
      <main className="auth-card">
        <h1>เข้าสู่ระบบ</h1>
        <form onSubmit={onSubmit} noValidate>
          <label>
            อีเมล
            <input
              type="email"
              name="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </label>
          <label>
            รหัสผ่าน
            <input
              type="password"
              name="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </label>

          {error !== null && (
            <p role="alert" className="form-error">
              {error}
            </p>
          )}

          <button type="submit" disabled={submitting}>
            {submitting ? 'กำลังเข้าสู่ระบบ…' : 'เข้าสู่ระบบ'}
          </button>
        </form>
        <p>
          ยังไม่มีบัญชี? <Link to="/register">สมัครสมาชิก</Link>
        </p>
      </main>
    </>
  )
}
