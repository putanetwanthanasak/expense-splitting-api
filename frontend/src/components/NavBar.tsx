/**
 * NavBar — the persistent top bar for authenticated screens (SPEC §14, Phase
 * 14). Two links: Groups (home) and Invitations, the latter carrying a badge
 * with the caller's pending-invitation count.
 *
 * The count comes in as a prop from AppLayout, which fetches it once per
 * navigation (via usePendingInvitationCount) and shares the same number with
 * the desktop <Sidebar> — one GET /api/me/invitations per navigation, not one
 * per nav surface.
 *
 * On desktop (min-width: 1024px) this bar is hidden by CSS and the Sidebar
 * takes over; below that it renders exactly as before.
 */

import { NavLink } from 'react-router-dom'

export function NavBar({ pendingCount }: { pendingCount: number }) {
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
