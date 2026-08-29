import { useAuth } from '../auth/auth-context'

/**
 * Placeholder landing screen behind the protected route. The group list
 * (SPEC §14) arrives in a later phase; for now this exists to prove that
 * auth-gated content renders only when signed in.
 */
export function HomePage() {
  const { user, logout } = useAuth()

  return (
    <main className="auth-card">
      <h1>Expense Splitting</h1>
      <p>
        Signed in as <strong>{user?.name}</strong> ({user?.email}).
      </p>
      <p>Your groups will show up here.</p>
      <button type="button" onClick={logout}>
        Log out
      </button>
    </main>
  )
}
