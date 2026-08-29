/**
 * token.ts — where the JWT lives on the client.
 *
 * One module so `api.ts` (the interceptor) and `AuthContext` (login/logout)
 * agree on storage. Kept separate from `api.ts` to avoid an import cycle.
 */

const STORAGE_KEY = 'esa.jwt'

export function getToken(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY)
  } catch {
    // Private-mode / disabled storage: behave as logged out rather than crash.
    return null
  }
}

export function setToken(token: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, token)
  } catch {
    /* ignore — the token just won't persist across reloads */
  }
}

export function clearToken(): void {
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch {
    /* ignore */
  }
}
