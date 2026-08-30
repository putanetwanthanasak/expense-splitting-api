/**
 * AppLayout — wraps every authenticated route. Two navigation surfaces:
 *
 *   - <NavBar>   the mobile top bar (Phase 14), shown below the desktop
 *                breakpoint.
 *   - <Sidebar>  the desktop nav shell (Phase 16), a `display: none` sibling
 *                below 1024px and the only nav at/above it (where <NavBar> is
 *                hidden by CSS). See styles/desktop.css.
 *
 * The Sidebar is a sibling of `.app-shell`, not a child, so that below the
 * breakpoint `#root` still contains exactly `.app-shell` as it did before this
 * phase — the mobile DOM and layout are unchanged.
 *
 * Both nav surfaces stay mounted at all times (CSS, not unmounting, decides
 * which is visible), so the pending-invitation count is fetched *here* — once
 * per navigation via usePendingInvitationCount — and passed down as a prop to
 * both. If each component called the hook itself, every navigation would fire
 * GET /api/me/invitations twice.
 *
 * Individual pages render into the <Outlet />.
 */

import { Outlet } from 'react-router-dom'

import { usePendingInvitationCount } from '../lib/usePendingInvitationCount'
import { NavBar } from './NavBar'
import { Sidebar } from './Sidebar'

export function AppLayout() {
  const pendingCount = usePendingInvitationCount()

  return (
    <>
      <Sidebar pendingCount={pendingCount} />
      <div className="app-shell">
        <NavBar pendingCount={pendingCount} />
        <Outlet />
      </div>
    </>
  )
}
