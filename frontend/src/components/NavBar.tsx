/**
 * NavBar — the persistent top bar for authenticated screens (SPEC §14, Phase
 * 14). Two links: Groups (home) and Invitations, the latter carrying a badge
 * with the caller's pending-invitation count.
 *
 * The count is fetched once per navigation (on `location.pathname` change) —
 * good enough to notice a new invite after visiting another page, without
 * polling or any global state management (per the phase spec).
 */

import { useEffect, useState } from 'react'
import { NavLink, useLocation } from 'react-router-dom'

import { invitationsApi } from '../lib/api'

export function NavBar() {
  const location = useLocation()
  const [pendingCount, setPendingCount] = useState(0)

  useEffect(() => {
    let cancelled = false
    invitationsApi
      .list()
      .then((invites) => {
        if (!cancelled) setPendingCount(invites.length)
      })
      .catch(() => {
        // Quiet failure: the badge just doesn't update. The Invitations page
        // itself surfaces a real load error when the user visits it.
      })
    return () => {
      cancelled = true
    }
  }, [location.pathname])

  const linkClass = ({ isActive }: { isActive: boolean }) =>
    isActive ? 'nav-link nav-link-active' : 'nav-link'

  return (
    <nav className="nav-bar">
      <NavLink to="/" end className={linkClass}>
        Groups
      </NavLink>
      <NavLink to="/invitations" className={linkClass}>
        Invitations
        {pendingCount > 0 && (
          <span className="nav-badge" aria-label={`${pendingCount} pending invitations`}>
            {pendingCount}
          </span>
        )}
      </NavLink>
    </nav>
  )
}
