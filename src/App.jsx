import { Navigate, Route, Routes } from 'react-router-dom'
import { useAuth } from './lib/AuthContext.jsx'
import { useSubscription } from './lib/SubscriptionContext.jsx'
import Login from './pages/Login.jsx'
import Subscribe from './pages/Subscribe.jsx'
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

// Signed in AND subscribed. Never wrap /subscribe in this - a signed-in,
// unsubscribed user has to be able to land there or they're stuck bouncing.
function RequireSubscription({ children }) {
  const { user, loading: authLoading } = useAuth()
  const { isActive, loading: subLoading } = useSubscription()
  if (authLoading || subLoading) return <div className="page-loading">Loading…</div>
  if (!user) return <Navigate to="/login" replace />
  if (!isActive) return <Navigate to="/subscribe" replace />
  return children
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route
        path="/subscribe"
        element={
          <RequireAuth>
            <Subscribe />
          </RequireAuth>
        }
      />
      <Route
        path="/entities"
        element={
          <RequireSubscription>
            <EntityPicker />
          </RequireSubscription>
        }
      />
      <Route
        path="/entities/:entityId"
        element={
          <RequireSubscription>
            <EntityLayout />
          </RequireSubscription>
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
