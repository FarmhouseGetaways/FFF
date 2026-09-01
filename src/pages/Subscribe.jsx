import { useAuth } from '../lib/AuthContext.jsx'
import { useSubscription } from '../lib/SubscriptionContext.jsx'

export default function Subscribe() {
  const { user, signOut } = useAuth()
  const { subscription } = useSubscription()

  return (
    <div className="auth-page">
      <div className="auth-card">
        <h1>Farmgirl Books</h1>
        <p className="auth-subtitle">
          {subscription?.status === 'past_due'
            ? 'Your last payment didn’t go through.'
            : subscription?.status === 'canceled'
              ? 'Your subscription has ended.'
              : 'Almost there — you need an active subscription to use your books.'}
        </p>
        <p>Signed in as {user?.email}.</p>
        <p className="form-info">
          Subscription checkout isn&apos;t wired up here yet — check back shortly.
        </p>
        <button type="button" className="link-button" onClick={signOut}>
          Sign out
        </button>
      </div>
    </div>
  )
}
