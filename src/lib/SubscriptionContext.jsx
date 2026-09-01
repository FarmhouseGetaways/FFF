import { createContext, useContext, useEffect, useState } from 'react'
import { supabase } from './supabaseClient'
import { useAuth } from './AuthContext.jsx'

const SubscriptionContext = createContext(null)

export function SubscriptionProvider({ children }) {
  const { user, loading: authLoading } = useAuth()
  const [subscription, setSubscription] = useState(undefined) // undefined = loading, null = none on file

  async function refresh() {
    if (!user) {
      setSubscription(null)
      return
    }
    const { data } = await supabase
      .from('subscriptions')
      .select('status, current_period_end, provider')
      .eq('user_id', user.id)
      .maybeSingle()
    setSubscription(data ?? null)
  }

  useEffect(() => {
    // Wait for AuthContext to actually settle before deciding anything.
    // `user` reads as undefined both while auth is still resolving AND once
    // it's confirmed there's no session - those are not the same thing.
    // Fetching here while auth is still loading could call refresh() with
    // user still undefined, which sets subscription to null ("confirmed no
    // subscription") when the truth is just "don't know yet" - and for one
    // render, that false reading is enough for a route guard to bounce a
    // genuinely-subscribed user off to /subscribe.
    if (authLoading) return
    setSubscription(undefined)
    refresh()
    // Keyed on user?.id, not the user object itself: Supabase fires both an
    // initial getSession() resolution and an onAuthStateChange event on
    // load, each handing AuthContext a distinct session object for the same
    // logical user. Keying on the object reference re-triggers this fetch
    // redundantly and can flash a stale "loading" render in between.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, user?.id])

  const isActive = subscription?.status === 'active'

  return (
    <SubscriptionContext.Provider
      value={{
        subscription,
        loading: authLoading || subscription === undefined,
        isActive,
        refresh,
      }}
    >
      {children}
    </SubscriptionContext.Provider>
  )
}

export function useSubscription() {
  const ctx = useContext(SubscriptionContext)
  if (!ctx) throw new Error('useSubscription must be used within SubscriptionProvider')
  return ctx
}
