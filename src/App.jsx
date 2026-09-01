import { Navigate, Route, Routes } from 'react-router-dom'
import { useAuth } from './lib/AuthContext.jsx'
import Login from './pages/Login.jsx'
import EntityPicker from './pages/EntityPicker.jsx'
import EntityLayout from './pages/EntityLayout.jsx'
import Transactions from './pages/Transactions.jsx'
import Accounts from './pages/Accounts.jsx'
import Categories from './pages/Categories.jsx'
import ProfitLoss from './pages/ProfitLoss.jsx'
import BalanceSheet from './pages/BalanceSheet.jsx'

function RequireAuth({ children }) {
  const { user, loading } = useAuth()
  if (loading) return <div className="page-loading">Loading…</div>
  if (!user) return <Navigate to="/login" replace />
  return children
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route
        path="/entities"
        element={
          <RequireAuth>
            <EntityPicker />
          </RequireAuth>
        }
      />
      <Route
        path="/entities/:entityId"
        element={
          <RequireAuth>
            <EntityLayout />
          </RequireAuth>
        }
      >
        <Route index element={<Navigate to="transactions" replace />} />
        <Route path="transactions" element={<Transactions />} />
        <Route path="accounts" element={<Accounts />} />
        <Route path="categories" element={<Categories />} />
        <Route path="profit-loss" element={<ProfitLoss />} />
        <Route path="balance-sheet" element={<BalanceSheet />} />
      </Route>
      <Route path="*" element={<Navigate to="/entities" replace />} />
    </Routes>
  )
}
