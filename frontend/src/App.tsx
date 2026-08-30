import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'

import { AuthProvider } from './auth/AuthContext'
import { ProtectedRoute } from './auth/ProtectedRoute'
import { AppLayout } from './components/AppLayout'
import { AddExpensePage } from './pages/AddExpensePage'
import { BalanceSummaryPage } from './pages/BalanceSummaryPage'
import { GroupDetailPage } from './pages/GroupDetailPage'
import { GroupListPage } from './pages/GroupListPage'
import { InvitationsPage } from './pages/InvitationsPage'
import { LoginPage } from './pages/LoginPage'
import { RegisterPage } from './pages/RegisterPage'
import { SettleUpPage } from './pages/SettleUpPage'

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />
          <Route
            element={
              <ProtectedRoute>
                <AppLayout />
              </ProtectedRoute>
            }
          >
            <Route path="/" element={<GroupListPage />} />
            <Route path="/invitations" element={<InvitationsPage />} />
            <Route path="/groups/:groupId" element={<GroupDetailPage />} />
            <Route path="/groups/:groupId/expenses/new" element={<AddExpensePage />} />
            <Route path="/groups/:groupId/balances" element={<BalanceSummaryPage />} />
            <Route path="/groups/:groupId/settle" element={<SettleUpPage />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  )
}
