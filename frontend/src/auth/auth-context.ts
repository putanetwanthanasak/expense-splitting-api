/**
 * The React context object + `useAuth` hook, kept in a JSX-free module so the
 * provider component in `AuthContext.tsx` is the only thing that file exports
 * (keeps react-refresh happy).
 */

import { createContext, useContext } from 'react'

import type { User } from '../lib/api'

export interface AuthContextValue {
  user: User | null
  /** True until the initial "am I still logged in?" check settles. */
  loading: boolean
  login: (email: string, password: string) => Promise<void>
  register: (email: string, password: string, name: string) => Promise<void>
  logout: () => void
}

export const AuthContext = createContext<AuthContextValue | null>(null)

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) {
    throw new Error('useAuth must be used within <AuthProvider>')
  }
  return ctx
}
