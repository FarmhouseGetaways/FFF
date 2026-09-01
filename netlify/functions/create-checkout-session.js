// Creates a Stripe Checkout session for the signed-in Supabase user and
// returns its URL for the frontend to redirect to. Uses plain fetch against
// Stripe's REST API (no stripe SDK) so there's no server-side dependency to
// install/bundle - this machine has no local Node to test an npm install with.

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
  const priceId = process.env.STRIPE_PRICE_ID

  if (!supabaseUrl || !anonKey || !serviceKey || !stripeKey || !priceId) {
    return new Response('Server not configured', { status: 500 })
  }

  const userRes = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: { Authorization: `Bearer ${token}`, apikey: anonKey },
  })
  if (!userRes.ok) return new Response('Unauthorized', { status: 401 })
  const user = await userRes.json()

  // Reuse an existing Stripe customer if this user already has one on file
  // (e.g. re-subscribing after a cancellation) so billing history stays together.
  const subRes = await fetch(
    `${supabaseUrl}/rest/v1/subscriptions?user_id=eq.${user.id}&select=provider_customer_id`,
    { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` } }
  )
  const subRows = subRes.ok ? await subRes.json() : []
  const existingCustomerId = subRows?.[0]?.provider_customer_id

  const siteUrl = process.env.URL || process.env.DEPLOY_PRIME_URL || 'http://localhost:8888'

  const params = new URLSearchParams({
    mode: 'subscription',
    'line_items[0][price]': priceId,
    'line_items[0][quantity]': '1',
    success_url: `${siteUrl}/entities?checkout=success`,
    cancel_url: `${siteUrl}/subscribe?checkout=cancelled`,
    client_reference_id: user.id,
    'metadata[supabase_user_id]': user.id,
    'subscription_data[metadata][supabase_user_id]': user.id,
  })
  if (existingCustomerId) {
    params.set('customer', existingCustomerId)
  } else {
    params.set('customer_email', user.email)
  }

  const checkoutRes = await fetch('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${stripeKey}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params.toString(),
  })

  if (!checkoutRes.ok) {
    const err = await checkoutRes.text()
    console.error('Stripe checkout session creation failed', err)
    return new Response('Could not start checkout', { status: 502 })
  }

  const session = await checkoutRes.json()
  return new Response(JSON.stringify({ url: session.url }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}
