// Turn browser notifications on for this device.
//
// Deliberately per-device rather than per-account: a subscription belongs to
// one browser install, so saying yes on a phone says nothing about a laptop.
// The wording reflects that instead of pretending it's an account setting.
//
// Added 5 Sep 2026 for the Mini Barn Market kiosk — when a customer buys
// something the catalog doesn't know and says a price out loud, somebody has
// to look at it, and a badge nobody opens the app to see isn't somebody
// looking.
import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'

const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY

// The push API wants the key as raw bytes, not base64url text.
function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = window.atob(base64)
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)))
}

const supported =
  typeof window !== 'undefined' &&
  'serviceWorker' in navigator &&
  'PushManager' in window &&
  'Notification' in window

export default function NotificationToggle() {
  const [state, setState] = useState('checking')  // checking|off|on|denied|unsupported|busy
  const [error, setError] = useState('')

  useEffect(() => {
    if (!supported || !VAPID_PUBLIC_KEY) { setState('unsupported'); return }
    if (Notification.permission === 'denied') { setState('denied'); return }
    navigator.serviceWorker.getRegistration('/sw.js')
      .then((reg) => (reg ? reg.pushManager.getSubscription() : null))
      .then((sub) => setState(sub ? 'on' : 'off'))
      .catch(() => setState('off'))
  }, [])

  async function enable() {
    setError('')
    setState('busy')
    try {
      const permission = await Notification.requestPermission()
      if (permission !== 'granted') { setState(permission === 'denied' ? 'denied' : 'off'); return }

      const reg = await navigator.serviceWorker.register('/sw.js')
      await navigator.serviceWorker.ready

      const sub = await reg.pushManager.subscribe({
        // Web Push requires this to be true - the browser will not deliver a
        // message the user cannot see.
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
      })

      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch('/.netlify/functions/push-subscribe', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session?.access_token || ''}`,
        },
        body: JSON.stringify({ subscription: sub.toJSON() }),
      })
      if (!res.ok) {
        const b = await res.json().catch(() => ({}))
        throw new Error(b.error || 'Could not save the subscription.')
      }
      setState('on')
    } catch (err) {
      setError(err.message || String(err))
      setState('off')
    }
  }

  async function disable() {
    setError('')
    setState('busy')
    try {
      const reg = await navigator.serviceWorker.getRegistration('/sw.js')
      const sub = reg && (await reg.pushManager.getSubscription())
      if (sub) {
        const { data: { session } } = await supabase.auth.getSession()
        await fetch('/.netlify/functions/push-subscribe', {
          method: 'DELETE',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${session?.access_token || ''}`,
          },
          body: JSON.stringify({ endpoint: sub.endpoint }),
        })
        await sub.unsubscribe()
      }
      setState('off')
    } catch (err) {
      setError(err.message || String(err))
      setState('on')
    }
  }

  if (state === 'unsupported') {
    return (
      <p className="form-notice">
        This browser can’t do notifications. Safari on iPhone only can once the
        app is added to the Home Screen.
      </p>
    )
  }

  return (
    <div>
      {state === 'denied' ? (
        <p className="form-notice">
          Notifications are blocked for this site. Turn them back on in your
          browser’s settings for this site, then reload.
        </p>
      ) : (
        <button
          type="button"
          className={state === 'on' ? 'header-btn header-btn--sm' : 'header-btn header-btn--sm'}
          disabled={state === 'busy' || state === 'checking'}
          onClick={state === 'on' ? disable : enable}
        >
          {state === 'busy' ? 'Just a moment…'
            : state === 'on' ? 'Turn off notifications on this device'
            : 'Notify me on this device'}
        </button>
      )}
      {state === 'on' && (
        <p className="form-notice">
          This device will be told when the stand goes offline, when somebody
          tries to check out while it is down, and when it sells something
          that isn’t in the catalog.
        </p>
      )}
      {error && <p className="form-notice">{error}</p>}
    </div>
  )
}
