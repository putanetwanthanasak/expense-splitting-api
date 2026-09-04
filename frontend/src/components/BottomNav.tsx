/**
 * BottomNav — mobile bottom tab bar (Phase 19 foundation piece).
 *
 * Same 2 destinations as the existing <NavBar> (top bar, mobile) and
 * <Sidebar> (desktop): Groups (/) and Invitations (/invitations), the
 * latter carrying the same pending-invitation badge. Styled with ds/color/*
 * tokens (styles/tokens.css) — see this component's Phase 19 report for a
 * flagged gap: there is no ds/size/mobile/* token namespace yet, so the
 * geometry below is hand-picked rem values in the same style as the rest of
 * index.css's mobile baseline, not token references.
 *
 * NOT wired into AppLayout yet — <NavBar> is still the only mobile nav in
 * the render tree. This file is built and exported in isolation for review;
 * nothing else imports it.
 *
 * No icon library exists anywhere in this codebase (checked: package.json
 * has no icon dependency, and NavBar/Sidebar are text-only), so these are
 * small inline SVGs rather than a new dependency for two icons.
 */

import { NavLink } from 'react-router-dom'

function GroupsIcon({ active }: { active: boolean }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M3 10.5 12 4l9 6.5M5.5 9.5V19a1 1 0 0 0 1 1h4v-5.5h3V20h4a1 1 0 0 0 1-1V9.5"
        stroke="currentColor"
        strokeWidth={active ? 2.25 : 1.75}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  )
}

function InvitationsIcon({ active }: { active: boolean }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect
        x="3.5"
        y="5.5"
        width="17"
        height="13"
        rx="2"
        stroke="currentColor"
        strokeWidth={active ? 2.25 : 1.75}
      />
      <path
        d="M4 7l8 6 8-6"
        stroke="currentColor"
        strokeWidth={active ? 2.25 : 1.75}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

export function BottomNav({ pendingCount = 0 }: { pendingCount?: number }) {
  const itemClass = ({ isActive }: { isActive: boolean }) =>
    isActive ? 'bottom-nav-item bottom-nav-item-active' : 'bottom-nav-item'

  return (
    <nav className="bottom-nav" aria-label="Primary">
      <NavLink to="/" end className={itemClass}>
        {({ isActive }) => (
          <>
            <GroupsIcon active={isActive} />
            <span>Groups</span>
          </>
        )}
      </NavLink>
      <NavLink to="/invitations" className={itemClass}>
        {({ isActive }) => (
          <>
            <span className="bottom-nav-icon-wrap">
              <InvitationsIcon active={isActive} />
              {pendingCount > 0 && (
                <span
                  className="nav-badge bottom-nav-badge"
                  aria-label={`${pendingCount} pending invitations`}
                >
                  {pendingCount}
                </span>
              )}
            </span>
            <span>Invitations</span>
          </>
        )}
      </NavLink>
    </nav>
  )
}
