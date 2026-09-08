/**
 * POST /.netlify/functions/pos-request
 *   { entityId, locationName, shippingAddress?, notes? }
 *
 * A customer asking for another checkout stand on their account. Cory, 8 Sep
 * 2026: "I need them to be able to order another POS/Business form within
 * their account... This should be in the software side of it" - and,
 * choosing between an instant self-serve provision and a request he follows
 * up on: "Request only, you follow up."
 *
 * WHY A FUNCTION AND NOT JUST A CLIENT-SIDE INSERT. The row itself could be
 * inserted straight from the browser - RLS in 0010_pos_requests.sql already
 * only lets an owner file this against their own entity. But turning that
 * into a push to every admin needs the VAPID private key and the service
 * role, neither of which belongs in the browser. So the insert happens here
 * too, right next to the notify, rather than splitting one action across a
 * client insert and a second privileged call.
 *
 * WHO GETS PUSHED, AND WHY THIS ISN'T push-send.mjs. That function resolves
 * its recipient from an entity's OWNER - built for "tell the business their
 * stand is down." This is the opposite direction: tell the PLATFORM ADMIN a
 * business wants something. Different recipient, so a different (much
 * smaller) function, rather than bending push-send's contract to cover both.
 */
import webpush from "web-push";

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
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  const anonKey = process.env.VITE_SUPABASE_ANON_KEY;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !anonKey || !serviceKey) return json({ error: "Supabase is not configured." }, 503);

  const user = await userFromToken(req, supabaseUrl, anonKey);
  if (!user) return json({ error: "Sign in first." }, 401);

  let body;
  try { body = await req.json(); } catch { return json({ error: "Bad request" }, 400); }
  const entityId = String(body?.entityId || "").trim();
  const locationName = String(body?.locationName || "").trim();
  if (!entityId || !locationName) return json({ error: "Which business, and what should this stand be called?" }, 400);

  const headers = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json" };

  // Ownership from the database, never trusted from the request - same rule
  // as every other cross-boundary call in this codebase.
  const entRes = await fetch(
    `${supabaseUrl}/rest/v1/entities?id=eq.${encodeURIComponent(entityId)}&select=id,name,owner_id`,
    { headers }
  );
  const entities = entRes.ok ? await entRes.json().catch(() => []) : [];
  const entity = entities[0];
  if (!entity || entity.owner_id !== user.id) return json({ error: "Not your business." }, 403);

  const insertRes = await fetch(`${supabaseUrl}/rest/v1/pos_requests`, {
    method: "POST",
    headers: { ...headers, Prefer: "return=representation" },
    body: JSON.stringify({
      entity_id: entityId,
      requested_by: user.id,
      location_name: locationName.slice(0, 80),
      shipping_address: (body.shippingAddress || "").slice(0, 500) || null,
      notes: (body.notes || "").slice(0, 1000) || null,
    }),
  });
  if (!insertRes.ok) {
    return json({ error: "Could not file that request." }, 502);
  }

  // Best-effort from here down - the request is already filed and real
  // regardless of whether a push actually lands. A customer's request must
  // never fail because a phone didn't answer.
  try {
    const publicKey = process.env.VAPID_PUBLIC_KEY;
    const privateKey = process.env.VAPID_PRIVATE_KEY;
    const subject = process.env.VAPID_SUBJECT || "mailto:farmhousegetaways@gmail.com";
    if (publicKey && privateKey) {
      const adminRes = await fetch(`${supabaseUrl}/rest/v1/profiles?is_admin=eq.true&select=id`, { headers });
      const admins = adminRes.ok ? await adminRes.json().catch(() => []) : [];
      const ids = admins.map((a) => a.id);
      if (ids.length) {
        const subRes = await fetch(
          `${supabaseUrl}/rest/v1/push_subscriptions?user_id=in.(${ids.join(",")})&select=id,endpoint,p256dh,auth`,
          { headers }
        );
        const subs = subRes.ok ? await subRes.json().catch(() => []) : [];
        if (subs.length) {
          webpush.setVapidDetails(subject, publicKey, privateKey);
          const payload = JSON.stringify({
            title: "New POS request",
            body: `${entity.name} wants a stand for "${locationName}"`,
            url: "/admin",
            tag: "pos-request",
            urgent: false,
            at: Date.now(),
          });
          const dead = [];
          await Promise.all(subs.map(async (s) => {
            try {
              await webpush.sendNotification(
                { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
                payload,
                { urgency: "normal", TTL: 86400 }
              );
            } catch (err) {
              if (err?.statusCode === 404 || err?.statusCode === 410) dead.push(s.id);
            }
          }));
          if (dead.length) {
            await fetch(`${supabaseUrl}/rest/v1/push_subscriptions?id=in.(${dead.join(",")})`, {
              method: "DELETE", headers,
            }).catch(() => {});
          }
        }
      }
    }
  } catch {
    // The request already exists; a push failure is not this call's problem.
  }

  return json({ ok: true });
};
