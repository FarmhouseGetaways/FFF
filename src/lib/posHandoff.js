import { supabase } from './supabaseClient'

/**
 * Open the checkout stand's admin for a business, without a second password.
 *
 * SAME WINDOW, ON PURPOSE (8 Sep 2026 - Cory: "instead of POS in a new
 * window, can we just use the same window? That way we can switch back?").
 * It used to open a new tab, which needed the whole "open the window
 * synchronously, before the fetch, or the popup blocker eats it" dance -
 * that trick existed only because a new tab needs one. A same-window
 * navigation has no popup to block, so there is nothing left to work around.
 * The trade this makes on purpose: the browser's own Back button is now
 * how you return to ivizhin, the same way it works everywhere
 * else on the web - see also the stand's own "← Home" pill, which is the
 * same idea from the other side.
 *
 * If anything fails we send them to the stand's front page rather than
 * nowhere: a customer screen they have to sign in past is a worse outcome
 * than a seamless one, and a far better outcome than a dead button.
 */
const POS_URL = import.meta.env.VITE_POS_URL || 'https://mbm-checkout.netlify.app'

export async function openPos(entityId) {
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
    window.location = body.url
    return { ok: true }
  } catch (err) {
    window.location = POS_URL
    return { ok: false, error: String(err.message || err) }
  }
}
