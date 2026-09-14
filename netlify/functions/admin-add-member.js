// Lets an admin add a member from the Accounts screen by email - a tester, a
// friend, a stand being onboarded - without that person signing up and
// paying first (Cory, 13 Sep 2026: "be able to add users on the back end").
//
// Creates the login with a temporary password, confirmed so they can sign in
// straight away, and makes them an active manual (free) member. The password
// comes back ONCE, for the admin to pass on; it is not stored or emailed.
// Chosen over Supabase's invite email because nothing here depends on email
// delivery (the project's built-in mailer is rate-limited and unbranded), and
// a Gmail address can also just use "Continue with Google" - Supabase links
// the Google identity to a confirmed account with the same email.
//
// If the email already has an account (signed up but never paid), that
// account is given free access instead and no password is changed.

function serviceHeaders(serviceKey) {
  return { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` }
}

// No 0/O/1/l/I - it gets read aloud or typed off a text message.
function tempPassword() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789'
  const bytes = new Uint8Array(12)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (b) => chars[b % chars.length]).join('')
}

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } })

export default async (request) => {
  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 })

  const token = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '')
  if (!token) return new Response('Unauthorized', { status: 401 })

  const supabaseUrl = process.env.VITE_SUPABASE_URL
  const anonKey = process.env.VITE_SUPABASE_ANON_KEY
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !anonKey || !serviceKey) return new Response('Server not configured', { status: 500 })

  let body
  try {
    body = await request.json()
  } catch {
    return new Response('Invalid request body', { status: 400 })
  }
  const email = String(body?.email || '').trim().toLowerCase()
  const fullName = String(body?.fullName || '').trim().slice(0, 120)
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return new Response('That doesn’t look like an email address.', { status: 400 })
  }

  // Same gate as admin-schedule-cancellation.js: the caller's own session,
  // checked against profiles.is_admin with the service key.
  const callerRes = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: { Authorization: `Bearer ${token}`, apikey: anonKey },
  })
  if (!callerRes.ok) return new Response('Unauthorized', { status: 401 })
  const caller = await callerRes.json()
  const callerProfileRes = await fetch(`${supabaseUrl}/rest/v1/profiles?id=eq.${caller.id}&select=is_admin`, {
    headers: serviceHeaders(serviceKey),
  })
  const callerRows = callerProfileRes.ok ? await callerProfileRes.json() : []
  if (!callerRows[0]?.is_admin) return new Response('Forbidden', { status: 403 })

  // Already has an account? profiles is filled from auth.users by the
  // handle_new_user trigger, so it is the place to look.
  const existingRes = await fetch(
    `${supabaseUrl}/rest/v1/profiles?email=ilike.${encodeURIComponent(email)}&select=id,is_admin,is_archived`,
    { headers: serviceHeaders(serviceKey) }
  )
  const existing = (existingRes.ok ? await existingRes.json() : [])[0]

  let userId
  let password = null
  if (existing) {
    if (existing.is_admin) return new Response('That email is a platform admin already.', { status: 400 })
    userId = existing.id
    const subRes = await fetch(`${supabaseUrl}/rest/v1/subscriptions?user_id=eq.${userId}&select=provider,status`, {
      headers: serviceHeaders(serviceKey),
    })
    const sub = (subRes.ok ? await subRes.json() : [])[0]
    if (sub?.provider === 'stripe' && sub.status === 'active') {
      return new Response('That email is already a paying member.', { status: 400 })
    }
    if (existing.is_archived) {
      await fetch(`${supabaseUrl}/rest/v1/profiles?id=eq.${userId}`, {
        method: 'PATCH',
        headers: { ...serviceHeaders(serviceKey), 'Content-Type': 'application/json', Prefer: 'return=minimal' },
        body: JSON.stringify({ is_archived: false }),
      })
    }
  } else {
    password = tempPassword()
    const createRes = await fetch(`${supabaseUrl}/auth/v1/admin/users`, {
      method: 'POST',
      headers: { ...serviceHeaders(serviceKey), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email,
        password,
        email_confirm: true,
        user_metadata: fullName ? { full_name: fullName } : {},
      }),
    })
    if (!createRes.ok) {
      const detail = await createRes.text()
      console.error('Create user failed', detail)
      return new Response('Could not create that account.', { status: 502 })
    }
    userId = (await createRes.json()).id
  }

  const upsertRes = await fetch(`${supabaseUrl}/rest/v1/subscriptions?on_conflict=user_id`, {
    method: 'POST',
    headers: {
      ...serviceHeaders(serviceKey),
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates,return=minimal',
    },
    body: JSON.stringify({
      user_id: userId,
      provider: 'manual',
      status: 'active',
      cancel_at: null,
      updated_at: new Date().toISOString(),
    }),
  })
  if (!upsertRes.ok) {
    console.error('Activate failed', await upsertRes.text())
    return new Response('The account was created but could not be given free access. Use Give free access on its row.', {
      status: 502,
    })
  }

  return json({ ok: true, email, existing: !!existing, password })
}
