/**
 * POST   /.netlify/functions/push-subscribe  { subscription }  -> save it
 * DELETE /.netlify/functions/push-subscribe  { endpoint }      -> forget it
 *
 * Called by the app itself after the browser grants notification permission.
 * Always a signed-in user — `Authorization: Bearer <token>` — because a
 * subscription belongs to a person, not an entity.
 *
 * The write goes through the service_role key, same as admin-products.mjs,
 * but the user_id is taken from the VERIFIED token and never from the body.
 * Otherwise anyone could register a push endpoint against somebody else's
 * account and receive their notifications.
 */

function json(body, status) {
  return new Response(JSON.stringify(body), {
    status: status || 200,
    headers: { "Content-Type": "application/json" },
  });
}

async function userFromToken(req, supabaseUrl, anonKey) {
  const auth = req.headers.get("authorization") || "";
  const token = auth.replace(/^Bearer\s+/i, "").trim();
  if (!token) return null;
  const res = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: { Authorization: `Bearer ${token}`, apikey: anonKey },
  });
  if (!res.ok) return null;
  const user = await res.json().catch(() => null);
  return user?.id ? user : null;
}

export default async (req) => {
  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  const anonKey = process.env.VITE_SUPABASE_ANON_KEY;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !anonKey || !serviceKey) {
    return json({ error: "Supabase is not configured." }, 503);
  }

  const user = await userFromToken(req, supabaseUrl, anonKey);
  if (!user) return json({ error: "Sign in first." }, 401);

  let body;
  try { body = await req.json(); } catch { return json({ error: "Bad request" }, 400); }

  const restHeaders = {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    "Content-Type": "application/json",
  };

  if (req.method === "DELETE") {
    const endpoint = body?.endpoint;
    if (!endpoint) return json({ error: "Missing endpoint" }, 400);
    await fetch(
      `${supabaseUrl}/rest/v1/push_subscriptions?endpoint=eq.${encodeURIComponent(endpoint)}&user_id=eq.${user.id}`,
      { method: "DELETE", headers: restHeaders }
    );
    return json({ ok: true });
  }

  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const sub = body?.subscription;
  const endpoint = sub?.endpoint;
  const p256dh = sub?.keys?.p256dh;
  const authKey = sub?.keys?.auth;
  if (!endpoint || !p256dh || !authKey) {
    return json({ error: "That isn't a push subscription." }, 400);
  }

  // Upsert on endpoint: re-subscribing the same browser (which happens on
  // its own when a push service rotates an endpoint) must not pile up rows.
  const res = await fetch(
    `${supabaseUrl}/rest/v1/push_subscriptions?on_conflict=endpoint`,
    {
      method: "POST",
      headers: { ...restHeaders, Prefer: "resolution=merge-duplicates,return=representation" },
      body: JSON.stringify([{
        user_id: user.id,
        endpoint,
        p256dh,
        auth: authKey,
        user_agent: (req.headers.get("user-agent") || "").slice(0, 300),
      }]),
    }
  );

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    return json({ error: "Could not save that subscription.", detail: detail.slice(0, 300) }, 502);
  }

  return json({ ok: true });
};
