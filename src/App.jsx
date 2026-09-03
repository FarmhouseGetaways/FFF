import { useEffect, useState } from 'react'
import { Navigate, Route, Routes, useSearchParams } from 'react-router-dom'
import { useAuth } from './lib/AuthContext.jsx'
import { useSubscription } from './lib/SubscriptionContext.jsx'
import { useIsAdmin } from './lib/useIsAdmin.js'
import Landing from './pages/Landing.jsx'
import Login from './pages/Login.jsx'
import Subscribe from './pages/Subscribe.jsx'
import Admin from './pages/Admin.jsx'
import EntityPicker from './pages/EntityPicker.jsx'
import EntityLayout from './pages/EntityLayout.jsx'
import Transactions from './pages/Transactions.jsx'
import Accounts from './pages/Accounts.jsx'
import Categories from './pages/Categories.jsx'
import Money from './pages/Money.jsx'
import Inventory from './pages/Inventory.jsx'
import EntitySettings from './pages/EntitySettings.jsx'
import ImportCsv from './pages/ImportCsv.jsx'

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
  const { isActive, loading: subLoading, refresh } = useSubscription()
  const [searchParams] = useSearchParams()
  const justCheckedOut = searchParams.get('checkout') === 'success'

  // Stripe's webhook can land a couple seconds after the browser redirect
  // back from Checkout. Rather than bounce a just-paid user straight to
  // /subscribe, poll briefly for the webhook to catch up.
  const [polling, setPolling] = useState(justCheckedOut)
  useEffect(() => {
    if (!justCheckedOut || isActive) {
      setPolling(false)
      return
    }
    let attempts = 0
    const id = setInterval(async () => {
      attempts += 1
      await refresh()
      if (attempts >= 8) {
        clearInterval(id)
        setPolling(false)
      }
    }, 1500)
    return () => clearInterval(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [justCheckedOut, isActive])

  if (authLoading || subLoading) return <div className="page-loading">Loading…</div>
  if (!user) return <Navigate to="/login" replace />
  if (!isActive && polling) return <div className="page-loading">Confirming your subscription…</div>
  if (!isActive) return <Navigate to="/subscribe" replace />
  return children
}

// Admin does NOT require an active subscription - the person managing
// everyone else's subscription can't be locked out by their own.
function RequireAdmin({ children }) {
  const { user, loading: authLoading } = useAuth()
  const { isAdmin, loading: adminLoading } = useIsAdmin()
  if (authLoading || adminLoading) return <div className="page-loading">Loading…</div>
  if (!user) return <Navigate to="/login" replace />
  if (!isAdmin) return <Navigate to="/entities" replace />
  return children
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Landing />} />
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
        path="/admin"
        element={
          <RequireAdmin>
            <Admin />
          </RequireAdmin>
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
        <Route path="money" element={<Money />} />
        <Route path="inventory" element={<Inventory />} />
        {/* Old separate statement pages - kept as redirects so a bookmark or open tab still lands somewhere real. */}
        <Route path="profit-loss" element={<Navigate to="../money" replace />} />
        <Route path="balance-sheet" element={<Navigate to="../money" replace />} />
        <Route path="settings" element={<EntitySettings />} />
        <Route path="import" element={<ImportCsv />} />
      </Route>
      <Route path="*" element={<Navigate to="/entities" replace />} />
    </Routes>
  )
}
