import crypto from 'node:crypto'

// Verifies Stripe's webhook signature by hand (HMAC-SHA256 over
// "<timestamp>.<raw body>", per Stripe's documented algorithm) so we don't
// need the stripe SDK as a dependency. This MUST run against the raw request
// body - re-serializing parsed JSON changes the bytes and the signature will
// never match, which is why this reads request.text() before anything else.
function verifyStripeSignature(rawBody, sigHeader, secret, toleranceSeconds = 300) {
  if (!sigHeader) return false
  const parts = Object.fromEntries(sigHeader.split(',').map((kv) => kv.split('=')))
  const timestamp = parts.t
  const v1 = parts.v1
  if (!timestamp || !v1) return false

  const signedPayload = `${timestamp}.${rawBody}`
  const expected = crypto.createHmac('sha256', secret).update(signedPayload, 'utf8').digest('hex')

  const expectedBuf = Buffer.from(expected, 'hex')
  const actualBuf = Buffer.from(v1, 'hex')
  if (expectedBuf.length !== actualBuf.length) return false
  if (!crypto.timingSafeEqual(expectedBuf, actualBuf)) return false

  const age = Math.abs(Date.now() / 1000 - Number(timestamp))
  return age <= toleranceSeconds
}

const STRIPE_STATUS_MAP = {
  active: 'active',
  trialing: 'active',
  past_due: 'past_due',
  unpaid: 'past_due',
  canceled: 'canceled',
  incomplete: 'incomplete',
  incomplete_expired: 'canceled',
  paused: 'paused',
}

export default async (request) => {
  const rawBody = await request.text()
  const signature = request.headers.get('stripe-signature')
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET

  if (!webhookSecret || !verifyStripeSignature(rawBody, signature, webhookSecret)) {
    return new Response('Invalid signature', { status: 400 })
  }

  const event = JSON.parse(rawBody)
  const supabaseUrl = process.env.VITE_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const obj = event.data?.object

  // Idempotent by design: every branch below writes the full current state
  // keyed on user_id via upsert, so a duplicate/replayed event (Stripe does
  // not guarantee exactly-once or in-order delivery) is harmless to re-apply.
  async function upsertSubscription(row) {
    const res = await fetch(`${supabaseUrl}/rest/v1/subscriptions?on_conflict=user_id`, {
      method: 'POST',
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        'Content-Type': 'application/json',
        Prefer: 'resolution=merge-duplicates,return=minimal',
      },
      body: JSON.stringify(row),
    })
    if (!res.ok) {
      console.error('Failed to upsert subscription', await res.text())
    }
  }

  switch (event.type) {
    case 'checkout.session.completed': {
      const userId = obj.client_reference_id || obj.metadata?.supabase_user_id
      if (userId) {
        await upsertSubscription({
          user_id: userId,
          provider: 'stripe',
          provider_customer_id: obj.customer,
          provider_subscription_id: obj.subscription,
          status: 'active',
          updated_at: new Date().toISOString(),
        })
      }
      break
    }
    case 'customer.subscription.created':
    case 'customer.subscription.updated':
    case 'customer.subscription.deleted': {
      const userId = obj.metadata?.supabase_user_id
      if (userId) {
        const status =
          event.type === 'customer.subscription.deleted'
            ? 'canceled'
            : (STRIPE_STATUS_MAP[obj.status] ?? 'incomplete')
        await upsertSubscription({
          user_id: userId,
          provider: 'stripe',
          provider_customer_id: obj.customer,
          provider_subscription_id: obj.id,
          status,
          current_period_end: obj.current_period_end
            ? new Date(obj.current_period_end * 1000).toISOString()
            : null,
          cancel_at: obj.cancel_at ? new Date(obj.cancel_at * 1000).toISOString() : null,
          updated_at: new Date().toISOString(),
        })
      }
      break
    }
    default:
      break
  }

  return new Response('ok', { status: 200 })
}
