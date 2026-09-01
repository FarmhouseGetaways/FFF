import { useState } from 'react'
import { useAuth } from '../lib/AuthContext.jsx'
import { useSubscription } from '../lib/SubscriptionContext.jsx'
import { supabase } from '../lib/supabaseClient'

export default function Subscribe() {
  const { user, signOut } = useAuth()
  const { subscription } = useSubscription()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

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
        <h1>Farmgirl Books</h1>
        <p className="auth-subtitle">{message}</p>
        <p>Signed in as {user?.email}.</p>

        <button type="button" className="btn-primary" onClick={handleSubscribe} disabled={busy}>
          {busy ? 'Redirecting…' : 'Subscribe — $27/mo'}
        </button>

        {error && <p className="form-error">{error}</p>}

        <button type="button" className="link-button" onClick={signOut}>
          Sign out
        </button>
      </div>
    </div>
  )
}
