/**
 * AppLayout — wraps every authenticated route. Three navigation surfaces:
 *
 *   - <NavBar>    the mobile top bar (Phase 14), shown below the desktop
 *                 breakpoint, every mobile route.
 *   - <Sidebar>   the desktop nav shell (Phase 16), a `display: none` sibling
 *                 below 1024px and the only nav at/above it (where <NavBar>
 *                 and <BottomNav> are both hidden by CSS). See
 *                 styles/desktop.css.
 *   - <BottomNav> the mobile bottom tab bar (Phase 19/20), shown only on the
 *                 2 routes it's built for — Groups (/) and Invitations
 *                 (/invitations) — below the desktop breakpoint. Every other
 *                 mobile route (group detail, add expense, balance summary,
 *                 settle up) stays drill-down/back-arrow navigation with just
 *                 <NavBar>, per the mobile-redesign rollout decision: those
 *                 pages are one level deep from Groups, not top-level
 *                 destinations. Rendered conditionally (unmount, not CSS)
 *                 since it has no reason to exist in the DOM elsewhere.
 *
 * The Sidebar and BottomNav are both siblings of `.app-shell`, not children —
 * both are `position: fixed` and don't need to be inside `.app-shell`'s flex
 * layout, matching the pattern the Sidebar already established.
 *
 * All nav surfaces read the same pendingCount, fetched *here* — once per
 * navigation via usePendingInvitationCount — and passed down as a prop. If
 * each component called the hook itself, every navigation would fire
 * GET /api/me/invitations 2-3 times instead of once.
 *
 * Individual pages render into the <Outlet />.
 */

import { Outlet, useLocation } from 'react-router-dom'

import { usePendingInvitationCount } from '../lib/usePendingInvitationCount'
import { BottomNav } from './BottomNav'
import { NavBar } from './NavBar'
import { Sidebar } from './Sidebar'

const BOTTOM_NAV_PATHS = new Set(['/', '/invitations'])

export function AppLayout() {
  const pendingCount = usePendingInvitationCount()
  const { pathname } = useLocation()
  const showBottomNav = BOTTOM_NAV_PATHS.has(pathname)

  return (
    <>
      <Sidebar pendingCount={pendingCount} />
      <div className={showBottomNav ? 'app-shell app-shell--bottom-nav' : 'app-shell'}>
        <NavBar pendingCount={pendingCount} />
        <Outlet />
      </div>
      {showBottomNav && <BottomNav pendingCount={pendingCount} />}
    </>
  )
}
