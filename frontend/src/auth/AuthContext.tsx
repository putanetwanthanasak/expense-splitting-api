/**
 * AuthProvider — holds the current user and the login / register / logout
 * actions. The JWT itself lives in `token.ts`; the context object and the
 * `useAuth` hook live in `auth-context.ts`.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'

import { authApi } from '../lib/api'
import { clearToken, getToken, setToken } from '../lib/token'
import { AuthContext } from './auth-context'
import type { AuthContextValue } from './auth-context'

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthContextValue['user']>(null)
  const [loading, setLoading] = useState(true)

  // On mount: if there's a stored token, confirm it still resolves to a user.
  // A 401 here goes through the interceptor (token cleared); we also clear
  // local state so the app renders as logged out.
  useEffect(() => {
    if (!getToken()) {
      setLoading(false)
      return
    }
    let cancelled = false
    authApi
      .me()
      .then((me) => {
        if (!cancelled) setUser(me)
      })
      .catch(() => {
        if (!cancelled) {
          clearToken()
          setUser(null)
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const login = useCallback(async (email: string, password: string) => {
    const { access_token } = await authApi.login(email, password)
    setToken(access_token)
    setUser(await authApi.me())
  }, [])

  const register = useCallback(
    async (email: string, password: string, name: string) => {
      await authApi.register(email, password, name)
      const { access_token } = await authApi.login(email, password)
      setToken(access_token)
      setUser(await authApi.me())
    },
    [],
  )

  const logout = useCallback(() => {
    clearToken()
    setUser(null)
  }, [])

  const value = useMemo<AuthContextValue>(
    () => ({ user, loading, login, register, logout }),
    [user, loading, login, register, logout],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
