/**
 * ProtectedRoute — gate for authenticated-only screens.
 *
 * While the initial session check is in flight we render nothing decisive
 * (avoids a login-page flash for already-authenticated users). Once settled,
 * an unauthenticated visitor is redirected to /login with the attempted
 * location stashed in router state so we can send them back after login.
 */

import type { ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router-dom'

import { useAuth } from './auth-context'

export function ProtectedRoute({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth()
  const location = useLocation()

  if (loading) {
    return <p className="centered-status">Loading…</p>
  }

  if (!user) {
    return <Navigate to="/login" replace state={{ from: location }} />
  }

  return <>{children}</>
}
