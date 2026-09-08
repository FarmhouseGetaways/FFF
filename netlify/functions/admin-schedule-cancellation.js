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
//   'schedule' - the 30-day-notice path. Cancels at the end of whichever
//     billing period is the first one on or after 30 days from now, so the
//     member is never cut off mid-period they've already paid for, and never
//     billed one extra full cycle beyond what the notice requires. For a
//     comped/manual member there is no real billing cycle to align to, so
//     the notice is a flat 30 days from today.
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

/** Add `count` of `interval` (Stripe's vocabulary: day/week/month/year) to a
 *  unix-seconds timestamp, using calendar month/year arithmetic rather than a
 *  fixed number of seconds - "a month later" is not always 30*86400 seconds,
 *  and getting that wrong is exactly the kind of off-by-a-few-days error that
 *  turns into a customer complaint. */
function addInterval(unixSeconds, interval, count) {
  const d = new Date(unixSeconds * 1000)
  switch (interval) {
    case 'day':
      d.setUTCDate(d.getUTCDate() + count)
      break
    case 'week':
      d.setUTCDate(d.getUTCDate() + 7 * count)
      break
    case 'year':
      d.setUTCFullYear(d.getUTCFullYear() + count)
      break
    case 'month':
    default:
      d.setUTCMonth(d.getUTCMonth() + count)
      break
  }
  return Math.floor(d.getTime() / 1000)
}

/** The first billing-period boundary at or after 30 days from now, read from
 *  the subscription's own current period and interval. Returns null if
 *  Stripe can't be read - the caller falls back to a flat 30 days rather
 *  than failing the whole request over it. */
async function billingCycleCancelAt(stripeKey, subscriptionId) {
  const res = await fetch(`https://api.stripe.com/v1/subscriptions/${subscriptionId}`, {
    headers: { Authorization: `Bearer ${stripeKey}` },
  })
  if (!res.ok) return null
  const sub = await res.json()
  const item = sub.items?.data?.[0]
  const interval = item?.price?.recurring?.interval || item?.plan?.interval || 'month'
  const intervalCount = item?.price?.recurring?.interval_count || item?.plan?.interval_count || 1
  const periodEnd = item?.current_period_end || sub.current_period_end
  if (!periodEnd) return null

  const minSeconds = Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60
  let cancelAt = periodEnd
  let guard = 0
  // A guard, not an assumption of "one loop is enough" - a monthly plan that
  // lapsed unnoticed for a year could need several steps to catch up to today.
  while (cancelAt < minSeconds && guard < 60) {
    cancelAt = addInterval(cancelAt, interval, intervalCount)
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
    `${supabaseUrl}/rest/v1/subscriptions?user_id=eq.${userId}&select=provider,provider_subscription_id`,
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

  // schedule / undo, from here down.
  if (hasStripeSub) {
    const cancelAtSeconds =
      action === 'schedule'
        ? (await billingCycleCancelAt(stripeKey, sub.provider_subscription_id)) ??
          Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60 // Stripe unreadable - fall back flat.
        : ''

    const updated = await setStripeCancelAt(stripeKey, sub.provider_subscription_id, cancelAtSeconds)
    if (!updated) return new Response('Could not update the subscription in Stripe', { status: 502 })

    const newCancelAt = updated.cancel_at ? new Date(updated.cancel_at * 1000).toISOString() : null
    await fetch(`${supabaseUrl}/rest/v1/subscriptions?user_id=eq.${userId}`, {
      method: 'PATCH',
      headers: { ...serviceHeaders(serviceKey), 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify({ cancel_at: newCancelAt, updated_at: new Date().toISOString() }),
    })
    return new Response(JSON.stringify({ ok: true, cancel_at: newCancelAt }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  // No Stripe subscription (manual/comped, or none on file) - nothing to ask
  // Stripe for a billing cycle on, so the notice is a flat 30 days, kept
  // entirely locally. Nothing external enforces this date; the admin screen
  // finalizes it on next load once it's passed (see Admin.jsx's `load()`).
  if (!sub) {
    return new Response('No subscription on file for this member.', { status: 400 })
  }
  const newCancelAt =
    action === 'schedule'
      ? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
      : null
  await fetch(`${supabaseUrl}/rest/v1/subscriptions?user_id=eq.${userId}`, {
    method: 'PATCH',
    headers: { ...serviceHeaders(serviceKey), 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify({ cancel_at: newCancelAt, updated_at: new Date().toISOString() }),
  })
  return new Response(JSON.stringify({ ok: true, cancel_at: newCancelAt }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}
