import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { mockLocation } from '../test/mockLocation'
import { ApiError, apiFetch, authApi } from './api'
import { getToken, setToken } from './token'

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

describe('api interceptor — 401 vs 403 (SPEC §10.2, §10.3)', () => {
  let loc: ReturnType<typeof mockLocation>

  beforeEach(() => {
    setToken('stored-token')
    loc = mockLocation('/groups') // anywhere that isn't /login
  })

  afterEach(() => {
    loc.restore()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    localStorage.clear()
  })

  it('401 on a normal endpoint clears the token and redirects to /login', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse(401, { detail: 'Not authenticated' })),
    )

    await expect(authApi.me()).rejects.toMatchObject({ status: 401 })
    expect(getToken()).toBeNull()
    expect(loc.assign).toHaveBeenCalledWith('/login')
  })

  it('401 on /api/auth/login does NOT log out or redirect — the caller sees the error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse(401, { detail: 'Incorrect email or password' }),
      ),
    )

    const err = await authApi.login('a@b.com', 'wrong').catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ApiError)
    expect((err as ApiError).status).toBe(401)
    expect((err as ApiError).detail).toBe('Incorrect email or password')
    expect(getToken()).toBe('stored-token') // still logged in
    expect(loc.assign).not.toHaveBeenCalled() // no redirect loop
  })

  it('403 shows an error but never logs out (SPEC §10.2)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse(403, { detail: 'Not a member of this group' })),
    )

    const err = await apiFetch('/api/groups/abc/balances').catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ApiError)
    expect((err as ApiError).status).toBe(403)
    expect(getToken()).toBe('stored-token')
    expect(loc.assign).not.toHaveBeenCalled()
  })
})
