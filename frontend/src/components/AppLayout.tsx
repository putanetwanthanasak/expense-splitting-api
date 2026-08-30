/**
 * AppLayout — wraps every authenticated route with the persistent NavBar
 * (Phase 14). Sits inside ProtectedRoute in App.tsx; individual pages render
 * into the <Outlet />.
 */

import { Outlet } from 'react-router-dom'

import { NavBar } from './NavBar'

export function AppLayout() {
  return (
    <div className="app-shell">
      <NavBar />
      <Outlet />
    </div>
  )
}
