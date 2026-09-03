import { useEffect, useState } from 'react'
import { Link, Navigate } from 'react-router-dom'
import Logo from '../components/Logo.jsx'
import { useAuth } from '../lib/AuthContext.jsx'
import { useSubscription } from '../lib/SubscriptionContext.jsx'
import { supabase } from '../lib/supabaseClient'

export default function Subscribe() {
  const { user, signOut } = useAuth()
  const { subscription, isActive, refresh } = useSubscription()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  // Self-healing: if this page was reached on a stale/racy read (or the
  // status flips active while sitting here - e.g. an admin just activated
  // the account), don't strand the user - re-check once on mount and bounce
  // to the app the moment it's actually active.
  useEffect(() => {
    refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (isActive) return <Navigate to="/entities" replace />

  async function handleSubscribe() {
    setBusy(true)
    setError('')
    try {
      const { data } = await supabase.auth.getSession()
      const token = data.session?.access_token
      const res = await fetch('/.netlify/functions/create-checkout-session', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) throw new Error('Could not start checkout. Please try again.')
      const { url } = await res.json()
      window.location.href = url
    } catch (err) {
      setError(err.message)
      setBusy(false)
    }
  }

  const message =
    subscription?.status === 'past_due'
      ? 'Your last payment didn’t go through — update your card to keep your books.'
      : subscription?.status === 'canceled'
        ? 'Your subscription has ended. Resubscribe to get back in.'
        : 'Almost there — subscribe to unlock your books.'

  return (
    <div className="auth-page">
      <div className="auth-card">
        <Link to="/" className="auth-back-link">
          ← Back to home
        </Link>
        <h1 className="brand-lockup">
          <Logo size={34} />
          Farmgirl Finance
        </h1>
        <p className="auth-subtitle">{message}</p>
        <p>Signed in as {user?.email}.</p>

        <ul className="subscribe-benefits">
          <li>Profit &amp; Loss and Balance Sheet, any date range</li>
          <li>Unlimited entities — properties, farmstands, anything you run</li>
          <li>Snap a photo of a receipt and it's logged for you</li>
          <li>Import bank or card statements from a CSV in seconds</li>
          <li>Access your books from any device, anywhere</li>
        </ul>

        <button type="button" className="btn-primary" onClick={handleSubscribe} disabled={busy}>
          {busy ? 'Redirecting…' : 'Subscribe — $27/mo'}
        </button>

        <p className="fine-print">
          $27/month, billed automatically until you cancel. To cancel, email{' '}
          <a href="mailto:financialfreedomfarmgirl@gmail.com">financialfreedomfarmgirl@gmail.com</a>{' '}
          at least 30 days before your renewal date — if your request comes in with less notice,
          you may be billed for one more month before your subscription ends. No refunds are
          issued for partial months.
        </p>

        {error && <p className="form-error">{error}</p>}

        <button type="button" className="link-button" onClick={signOut}>
          Sign out
        </button>
      </div>
    </div>
  )
}
