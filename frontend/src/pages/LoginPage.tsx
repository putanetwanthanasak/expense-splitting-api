import { useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'

import { useAuth } from '../auth/auth-context'
import { AuthBrandPanel } from '../components/AuthBrandPanel'
import { ApiError, consumeSessionExpiredFlag } from '../lib/api'

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
  // § Login/Register investigation, item 5: true only when the 401
  // interceptor (api.ts) actually bounced the user here. Lazy initializer,
  // not an effect + setState — this is a one-time synchronous read-and-
  // clear (consumeSessionExpiredFlag() clears the flag itself, so refreshing
  // /login afterward doesn't keep showing it), which is exactly what
  // useState's initializer form is for; an effect here would just cause an
  // extra render for no reason. Never set from a guess;
  // consumeSessionExpiredFlag() is the only writer's counterpart.
  const [sessionExpired] = useState(() => consumeSessionExpiredFlag())

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
        {/* Figma 2:1069 (§ Login/Register investigation, item 4): literal
            copy pulled live from the node, not translated/guessed. Reuses
            .page-subtitle -- same class, same mechanism as Group Detail's
            subtitle -- the rule has no dependency on a .page ancestor. */}
        <p className="page-subtitle">แบ่งค่าใช้จ่ายง่าย ๆ แล้วกลับไปสนุกกับเพื่อนต่อ</p>
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
        {/* Figma 2:1087-2:1091, literal copy pulled live from the nodes —
            title genuinely reads "Please log in again" in English there,
            same as every other title/label on this frame; not translated
            here, per instruction. Figma positions this as a sibling AFTER
            the whole login form (including the register link), but it
            renders BEFORE the "ยังไม่มีบัญชี?" paragraph here instead:
            desktop.css's existing .auth-card > p:last-child rule depends
            on that paragraph staying the actual last child, and this
            notice is conditional — putting it after would silently break
            that rule's centered/muted styling every time the notice
            shows. Kept the existing desktop selector untouched rather than
            widen this change into a refactor of shipped CSS. */}
        {sessionExpired && (
          <div className="session-notice">
            <p className="session-notice-title">Please log in again</p>
            <p className="session-notice-desc">
              เซสชันของคุณหมดอายุ ข้อมูลกลุ่มยังปลอดภัยและรอคุณอยู่
            </p>
          </div>
        )}
        <p>
          ยังไม่มีบัญชี? <Link to="/register">สมัครสมาชิก</Link>
        </p>
      </main>
    </>
  )
}
