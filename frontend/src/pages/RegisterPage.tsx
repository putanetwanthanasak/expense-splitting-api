import { useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'

import { useAuth } from '../auth/auth-context'
import { AuthBrandPanel } from '../components/AuthBrandPanel'
import { ApiError } from '../lib/api'

export function RegisterPage() {
  const { register } = useAuth()
  const navigate = useNavigate()

  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      await register(email, password, name)
      navigate('/', { replace: true })
    } catch (err) {
      // /api/auth/register is also interceptor-exempt (SPEC §10.3): a 409
      // "email already registered" must render here, not redirect.
      setError(
        err instanceof ApiError
          ? err.detail
          : 'สร้างบัญชีไม่สำเร็จ กรุณาลองใหม่อีกครั้ง',
      )
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <>
      <AuthBrandPanel />
      <main className="auth-card">
        <h1>สร้างบัญชีใหม่</h1>
        {/* Figma 2:1103 (§ Login/Register investigation, item 4): literal
            copy pulled live from the node, not translated/guessed. */}
        <p className="page-subtitle">เริ่มแบ่งบิลกับกลุ่มของคุณได้ในไม่กี่วินาที</p>
        <form onSubmit={onSubmit} noValidate>
          <label>
            ชื่อ
            <input
              type="text"
              name="name"
              autoComplete="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </label>
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
              autoComplete="new-password"
              minLength={8}
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
            {submitting ? 'กำลังสร้างบัญชี…' : 'สร้างบัญชี'}
          </button>
        </form>
        <p>
          มีบัญชีอยู่แล้ว? <Link to="/login">เข้าสู่ระบบ</Link>
        </p>
      </main>
    </>
  )
}
