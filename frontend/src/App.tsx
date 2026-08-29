import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'

import { AuthProvider } from './auth/AuthContext'
import { ProtectedRoute } from './auth/ProtectedRoute'
import { AddExpensePage } from './pages/AddExpensePage'
import { BalanceSummaryPage } from './pages/BalanceSummaryPage'
import { GroupDetailPage } from './pages/GroupDetailPage'
import { GroupListPage } from './pages/GroupListPage'
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
            path="/"
            element={
              <ProtectedRoute>
                <GroupListPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/groups/:groupId"
            element={
              <ProtectedRoute>
                <GroupDetailPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/groups/:groupId/expenses/new"
            element={
              <ProtectedRoute>
                <AddExpensePage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/groups/:groupId/balances"
            element={
              <ProtectedRoute>
                <BalanceSummaryPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/groups/:groupId/settle"
            element={
              <ProtectedRoute>
                <SettleUpPage />
              </ProtectedRoute>
            }
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  )
}
