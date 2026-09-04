/**
 * AppLayout — wraps every authenticated route. Three navigation surfaces,
 * each visible on a different slice of routes/breakpoints — never more than
 * one at a time on mobile:
 *
 *   - <NavBar>    the mobile top bar (Phase 14), below the desktop breakpoint
 *                 on every mobile route *except* Groups/Invitations (Phase
 *                 20) — those 2 have <BottomNav> instead, and showing both
 *                 would be a redundant duplicate nav (same 2 destinations,
 *                 same pending-count badge, visible twice on screen).
 *                 Unmounted, not CSS-hidden, on those 2 routes; still the
 *                 only way to jump to Groups/Invitations from a drill-down
 *                 page (group detail, add expense, balance summary, settle
 *                 up), which don't get <BottomNav>.
 *   - <Sidebar>   the desktop nav shell (Phase 16), a `display: none` sibling
 *                 below 1024px and the only nav at/above it (where <NavBar>
 *                 and <BottomNav> are both hidden by CSS). See
 *                 styles/desktop.css.
 *   - <BottomNav> the mobile bottom tab bar (Phase 19/20), shown only on the
 *                 2 routes it's built for — Groups (/) and Invitations
 *                 (/invitations) — below the desktop breakpoint. Every other
 *                 mobile route stays drill-down/back-arrow navigation with
 *                 just <NavBar>, per the mobile-redesign rollout decision:
 *                 those pages are one level deep from Groups, not top-level
 *                 destinations. Rendered conditionally (unmount, not CSS)
 *                 since it has no reason to exist in the DOM elsewhere.
 *
 * NavBar carries no non-navigational content (no logout/account menu — that
 * lives in GroupListPage's own header) — confirmed before unmounting it
 * conditionally, so nothing besides the 2 nav links is at stake here.
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
        {!showBottomNav && <NavBar pendingCount={pendingCount} />}
        <Outlet />
      </div>
      {showBottomNav && <BottomNav pendingCount={pendingCount} />}
    </>
  )
}
