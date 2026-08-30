/**
 * Sidebar — the desktop navigation shell, matching Figma "Sidebar/Desktop"
 * (node 5:3): brand mark, nav items for "กลุ่มของฉัน" (/) and "คำเชิญ"
 * (/invitations) with a pending-count badge, and a footer showing the
 * signed-in user.
 *
 * AppLayout renders this on every authenticated route, but it is only
 * *visible* at the desktop breakpoint (min-width: 1024px — see
 * styles/desktop.css). Below it the component is `display: none` and the
 * mobile <NavBar> handles navigation; the mobile layout is unchanged.
 *
 * Content is real app state: `useAuth().user` for the footer. The badge count
 * comes from `pendingCount`, which AppLayout fetches once (via
 * usePendingInvitationCount) and shares with both this component and <NavBar>
 * so a navigation triggers a single GET /api/me/invitations.
 */

import { Link, NavLink } from 'react-router-dom'

import { useAuth } from '../auth/auth-context'

function navItemClass({ isActive }: { isActive: boolean }): string {
  return isActive ? 'ds-navitem ds-navitem-active' : 'ds-navitem'
}

export function Sidebar({ pendingCount }: { pendingCount: number }) {
  const { user } = useAuth()

  return (
    <aside className="ds-sidebar" aria-label="แถบนำทาง">
      <Link to="/" className="ds-brand">
        <span className="ds-brand-mark" aria-hidden="true" />
        <span className="ds-brand-name">แบ่งจ่าย</span>
      </Link>

      <nav className="ds-sidebar-nav" aria-label="เมนูหลัก">
        <NavLink to="/" end className={navItemClass}>
          <span>กลุ่มของฉัน</span>
        </NavLink>
        <NavLink to="/invitations" className={navItemClass}>
          <span>คำเชิญ</span>
          {pendingCount > 0 && (
            <span
              className="ds-badge"
              aria-label={`คำเชิญที่รอตอบรับ ${pendingCount} รายการ`}
            >
              {pendingCount}
            </span>
          )}
        </NavLink>
      </nav>

      <div className="ds-sidebar-grow" />

      {user && (
        <div className="ds-sidebar-footer">
          <span className="ds-avatar" aria-hidden="true" />
          <span className="ds-sidebar-user">{user.name}</span>
        </div>
      )}
    </aside>
  )
}
