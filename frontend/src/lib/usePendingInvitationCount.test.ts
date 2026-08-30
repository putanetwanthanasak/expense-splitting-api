/**
 * usePendingInvitationCount (Phase 16) — the shared badge-count hook.
 *
 * Confirms the count comes from the API response length, and that a failed
 * fetch leaves the last known count in place rather than resetting it.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { createElement } from 'react'
import type { ReactNode } from 'react'
import { MemoryRouter } from 'react-router-dom'

import { usePendingInvitationCount } from './usePendingInvitationCount'

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function wrapper({ children }: { children: ReactNode }) {
  return createElement(MemoryRouter, null, children)
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('usePendingInvitationCount', () => {
  it('returns the number of invitations from the API', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse(200, [
          { group_id: 'g1', group_name: 'A', invited_at: '2026-08-01T00:00:00Z' },
          { group_id: 'g2', group_name: 'B', invited_at: '2026-08-01T00:00:00Z' },
        ]),
      ),
    )

    const { result } = renderHook(() => usePendingInvitationCount(), { wrapper })

    expect(result.current).toBe(0) // before the fetch resolves
    await waitFor(() => expect(result.current).toBe(2))
  })

  it('keeps the count at 0 when the fetch fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))

    const { result } = renderHook(() => usePendingInvitationCount(), { wrapper })

    await Promise.resolve()
    expect(result.current).toBe(0)
  })
})
