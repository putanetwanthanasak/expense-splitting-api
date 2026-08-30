/**
 * usePendingInvitationCount — the caller's number of pending group invitations,
 * refreshed once per navigation (on `location.pathname` change). This is the
 * exact fetch cadence the NavBar has used since Phase 14, lifted into a hook so
 * the desktop <Sidebar> and the mobile <NavBar> share one source of truth for
 * the badge count (no polling, no global state, no hardcoded number).
 *
 * Failure is quiet: the count simply doesn't update. The Invitations page
 * itself surfaces a real load error when the user goes there.
 */

import { useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'

import { invitationsApi } from './api'

export function usePendingInvitationCount(): number {
  const location = useLocation()
  const [count, setCount] = useState(0)

  useEffect(() => {
    let cancelled = false
    invitationsApi
      .list()
      .then((invites) => {
        if (!cancelled) setCount(invites.length)
      })
      .catch(() => {
        // Quiet: leave the last known count in place.
      })
    return () => {
      cancelled = true
    }
  }, [location.pathname])

  return count
}
