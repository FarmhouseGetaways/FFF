// Lets an admin schedule (or undo) a member's cancellation, or archive them
// outright - against the real Stripe subscription where one exists, instead
// of just flipping a local status flag. A local-only flip doesn't stop
// Stripe from billing, and the next renewal webhook would silently overwrite
// it back to "active" anyway.
//
// THREE ACTIONS, ONE FUNCTION, because all three touch the same two tables
// (subscriptions, profiles) and the same Stripe subscription, and an admin
// should only ever reach them through this one gate:
//
//   'schedule' - the 30-day-notice path. Cancels on the first monthly
//     anniversary of THEIR OWN ACTIVATION DATE (subscriptions.created_at -
//     our own record of when they went live with us, not Stripe's) that
//     falls at least 30 days out. Cory, 8 Sep 2026: "it shouldn't base it on
//     stripe, it should base it on the activation date with us." Billing
//     runs from that same date regardless of provider or whether a card
//     reader is even connected - a cash/digital-only stand is still live and
//     still billed - so it is the correct anchor for both a real Stripe
//     member and a comped/manual one, unifying what used to be two branches
//     into one calculation.
//   'undo' - clears a pending 'schedule', Stripe side and local side both.
//   'archive' - immediate. Cancels the Stripe subscription NOW (not at a
//     future date), sets the local subscription canceled, and sets the
//     profile's is_archived flag - Cory, 7 Sep 2026: "Archive should disable
//     the account immediately and move it to archived." A member who was
//     mid-'schedule' when archived is simply canceled now instead of later;
//     there is nothing left to undo.
//
// Neither the caller nor the TARGET may be a platform admin - Cory, 7 Sep
// 2026: "Admin should not have a deactivate or schedule cancellation." The
// UI already hides these buttons on an admin's own row; this is the same
// rule enforced server-side, because a hidden button is not a permission
// check.

function serviceHeaders(serviceKey) {
  return { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` }
}

/** Add one calendar month to a unix-seconds timestamp - "a month later" is
 *  not a fixed number of seconds, and getting that wrong (28 vs. 31 days) is
 *  exactly the kind of off-by-a-few-days error that turns into a customer
 *  complaint. Only 'month' is needed: this product has one price, billed
 *  monthly. */
function addMonth(unixSeconds) {
  const d = new Date(unixSeconds * 1000)
  d.setUTCMonth(d.getUTCMonth() + 1)
  return Math.floor(d.getTime() / 1000)
}

/** The first monthly anniversary of the member's OWN activation date that
 *  falls at least 30 days from now. `activatedAtIso` is
 *  subscriptions.created_at - the date they went live with us, which is ours
 *  to know regardless of what Stripe (or nothing, for a manual member)
 *  reports. */
function activationCancelAt(activatedAtIso) {
  const minSeconds = Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60
  let cancelAt = Math.floor(new Date(activatedAtIso).getTime() / 1000)
  let guard = 0
  // A guard, not an assumption of "one loop is enough" - a member activated
  // a year ago needs several steps to catch up to today's anniversary.
  while (cancelAt < minSeconds && guard < 1200) {
    cancelAt = addMonth(cancelAt)
    guard += 1
  }
  return cancelAt
}

async function cancelStripeNow(stripeKey, subscriptionId) {
  const res = await fetch(`https://api.stripe.com/v1/subscriptions/${subscriptionId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${stripeKey}` },
  })
  if (!res.ok) {
    const err = await res.text()
    console.error('Stripe subscription cancel failed', err)
    return false
  }
  return true
}

async function setStripeCancelAt(stripeKey, subscriptionId, cancelAtSeconds) {
  const res = await fetch(`https://api.stripe.com/v1/subscriptions/${subscriptionId}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${stripeKey}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ cancel_at: String(cancelAtSeconds) }).toString(),
  })
  if (!res.ok) {
    const err = await res.text()
    console.error('Stripe subscription update failed', err)
    return null
  }
  return res.json()
}

export default async (request) => {
  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 })
  }

  const authHeader = request.headers.get('authorization') || ''
  const token = authHeader.replace(/^Bearer\s+/i, '')
  if (!token) return new Response('Unauthorized', { status: 401 })

  const supabaseUrl = process.env.VITE_SUPABASE_URL
  const anonKey = process.env.VITE_SUPABASE_ANON_KEY
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const stripeKey = process.env.STRIPE_SECRET_KEY

  if (!supabaseUrl || !anonKey || !serviceKey || !stripeKey) {
    return new Response('Server not configured', { status: 500 })
  }

  let body
  try {
    body = await request.json()
  } catch {
    return new Response('Invalid request body', { status: 400 })
  }
  const { userId, action } = body
  if (!userId || !['schedule', 'undo', 'archive'].includes(action)) {
    return new Response('Invalid request body', { status: 400 })
  }

  const callerRes = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: { Authorization: `Bearer ${token}`, apikey: anonKey },
  })
  if (!callerRes.ok) return new Response('Unauthorized', { status: 401 })
  const caller = await callerRes.json()

  const callerProfileRes = await fetch(
    `${supabaseUrl}/rest/v1/profiles?id=eq.${caller.id}&select=is_admin`,
    { headers: serviceHeaders(serviceKey) }
  )
  const callerRows = callerProfileRes.ok ? await callerProfileRes.json() : []
  if (!callerRows[0]?.is_admin) return new Response('Forbidden', { status: 403 })

  const targetProfileRes = await fetch(
    `${supabaseUrl}/rest/v1/profiles?id=eq.${userId}&select=is_admin`,
    { headers: serviceHeaders(serviceKey) }
  )
  const targetRows = targetProfileRes.ok ? await targetProfileRes.json() : []
  if (!targetRows[0]) return new Response('No such member', { status: 404 })
  if (targetRows[0].is_admin) {
    return new Response('This is a platform admin account - none of these actions apply to it.', {
      status: 403,
    })
  }

  const subRes = await fetch(
    `${supabaseUrl}/rest/v1/subscriptions?user_id=eq.${userId}&select=provider,provider_subscription_id,created_at`,
    { headers: serviceHeaders(serviceKey) }
  )
  const subRows = subRes.ok ? await subRes.json() : []
  const sub = subRows[0]
  const hasStripeSub = sub?.provider === 'stripe' && !!sub?.provider_subscription_id

  if (action === 'archive') {
    if (hasStripeSub) {
      const ok = await cancelStripeNow(stripeKey, sub.provider_subscription_id)
      if (!ok) return new Response('Could not cancel the subscription in Stripe', { status: 502 })
    }
    // Local subscription row mirrors "canceled, right now" regardless of
    // provider - a manual/comped member has no Stripe side to update, but
    // still needs their own status to say they're done.
    if (sub) {
      await fetch(`${supabaseUrl}/rest/v1/subscriptions?user_id=eq.${userId}`, {
        method: 'PATCH',
        headers: {
          ...serviceHeaders(serviceKey),
          'Content-Type': 'application/json',
          Prefer: 'return=minimal',
        },
        body: JSON.stringify({ status: 'canceled', cancel_at: null, updated_at: new Date().toISOString() }),
      })
    }
    await fetch(`${supabaseUrl}/rest/v1/profiles?id=eq.${userId}`, {
      method: 'PATCH',
      headers: { ...serviceHeaders(serviceKey), 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify({ is_archived: true }),
    })
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  // schedule / undo, from here down. Both need a subscription row to exist -
  // there is nothing to schedule or undo for someone who was never activated.
  if (!sub) {
    return new Response('No subscription on file for this member.', { status: 400 })
  }

  // ONE calculation for both providers now - the member's own activation
  // date with us, never Stripe's. See activationCancelAt above.
  const newCancelAtIso =
    action === 'schedule' ? new Date(activationCancelAt(sub.created_at) * 1000).toISOString() : null

  if (hasStripeSub) {
    // Still tell Stripe when to actually stop billing - the DATE comes from
    // us, but Stripe is what executes it and fires the webhook back.
    const cancelAtSeconds = action === 'schedule' ? Math.floor(new Date(newCancelAtIso).getTime() / 1000) : ''
    const updated = await setStripeCancelAt(stripeKey, sub.provider_subscription_id, cancelAtSeconds)
    if (!updated) return new Response('Could not update the subscription in Stripe', { status: 502 })
  }

  // Manual/comped members have no Stripe side to update - see Admin.jsx's
  // `load()`, which is what actually finalizes a lapsed manual cancel_at.
  await fetch(`${supabaseUrl}/rest/v1/subscriptions?user_id=eq.${userId}`, {
    method: 'PATCH',
    headers: { ...serviceHeaders(serviceKey), 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify({ cancel_at: newCancelAtIso, updated_at: new Date().toISOString() }),
  })
  return new Response(JSON.stringify({ ok: true, cancel_at: newCancelAtIso }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}
