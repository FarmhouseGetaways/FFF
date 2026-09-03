// Lets an admin schedule (or undo) a member's cancellation against the real
// Stripe subscription, instead of just flipping the local status flag - a
// local-only flip doesn't stop Stripe from billing, and the next renewal
// webhook would silently overwrite it back to "active" anyway.
//
// "Schedule" sets Stripe's own `cancel_at` to 30 days out. Stripe bills
// normally for any renewal that falls before that timestamp (satisfying the
// "one more month in applicable cases" policy) and cancels automatically at
// cancel_at with no extra logic needed here - this function just kicks that
// off and mirrors the result locally for the admin screen. The webhook
// handler keeps `cancel_at` in sync going forward.

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
  if (!userId || !['schedule', 'undo'].includes(action)) {
    return new Response('Invalid request body', { status: 400 })
  }

  const callerRes = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: { Authorization: `Bearer ${token}`, apikey: anonKey },
  })
  if (!callerRes.ok) return new Response('Unauthorized', { status: 401 })
  const caller = await callerRes.json()

  const adminRes = await fetch(
    `${supabaseUrl}/rest/v1/profiles?id=eq.${caller.id}&select=is_admin`,
    { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` } }
  )
  const adminRows = adminRes.ok ? await adminRes.json() : []
  if (!adminRows[0]?.is_admin) return new Response('Forbidden', { status: 403 })

  const subRes = await fetch(
    `${supabaseUrl}/rest/v1/subscriptions?user_id=eq.${userId}&select=provider,provider_subscription_id`,
    { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` } }
  )
  const subRows = subRes.ok ? await subRes.json() : []
  const sub = subRows[0]
  if (!sub || sub.provider !== 'stripe' || !sub.provider_subscription_id) {
    return new Response(
      'No Stripe subscription on file for this member - use Activate/Deactivate instead.',
      { status: 400 }
    )
  }

  const cancelAtSeconds =
    action === 'schedule' ? Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60 : ''

  const stripeRes = await fetch(
    `https://api.stripe.com/v1/subscriptions/${sub.provider_subscription_id}`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${stripeKey}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ cancel_at: String(cancelAtSeconds) }).toString(),
    }
  )
  if (!stripeRes.ok) {
    const err = await stripeRes.text()
    console.error('Stripe subscription update failed', err)
    return new Response('Could not update the subscription in Stripe', { status: 502 })
  }
  const updated = await stripeRes.json()

  const newCancelAt = updated.cancel_at ? new Date(updated.cancel_at * 1000).toISOString() : null
  await fetch(`${supabaseUrl}/rest/v1/subscriptions?user_id=eq.${userId}`, {
    method: 'PATCH',
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
    },
    body: JSON.stringify({ cancel_at: newCancelAt, updated_at: new Date().toISOString() }),
  })

  return new Response(JSON.stringify({ ok: true, cancel_at: newCancelAt }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}
