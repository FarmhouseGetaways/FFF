import { supabase } from './supabaseClient'

/**
 * Open the checkout stand's admin for a business, without a second password.
 *
 * The window is opened FIRST, synchronously, and pointed at the ticket after
 * it arrives. Opening it later - inside the promise - is a pop-up blocked by
 * every browser, because by then the click that authorised it is over.
 *
 * If anything fails we send them to the stand's front page rather than
 * nowhere: a customer screen they have to sign in past is a worse outcome
 * than a seamless one, and a far better outcome than a dead button.
 */
const POS_URL = import.meta.env.VITE_POS_URL || 'https://mbm-checkout.netlify.app'

export async function openPos(entityId) {
  // No 'noopener' here: window.open returns null when it is set, which would
  // strand the tab we just opened at about:blank and send the ticket to the
  // tab the owner was already working in. The destination is our own stand.
  const win = window.open('', '_blank')

  try {
    const { data: { session } } = await supabase.auth.getSession()
    const res = await fetch('/.netlify/functions/pos-handoff', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session?.access_token || ''}`,
      },
      body: JSON.stringify({ entityId }),
    })
    const body = await res.json().catch(() => ({}))
    if (!res.ok || !body.url) throw new Error(body.error || 'handoff failed')
    if (win) win.location = body.url
    else window.location = body.url
    return { ok: true }
  } catch (err) {
    if (win) win.location = POS_URL
    else window.location = POS_URL
    return { ok: false, error: String(err.message || err) }
  }
}
