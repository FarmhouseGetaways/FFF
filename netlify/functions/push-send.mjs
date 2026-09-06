/**
 * POST /.netlify/functions/push-send
 *   headers: x-write-key: PRODUCTS_WRITE_KEY
 *   body:    { entityId, title, body, url?, tag? }
 *
 * Server-to-server only. Same door and same key as admin-products.mjs —
 * mbm-checkout has no Farmgirl Finance user session of its own, and the key
 * IS the credential.
 *
 * Sends to the OWNER of the entity, resolved here from entityId. The caller
 * never says who to notify, so a leaked key can at worst notify the owner of
 * an entity it already knew the id of, rather than push arbitrary messages to
 * arbitrary people.
 *
 * A 404 or 410 back from a push service means that browser install is gone
 * for good — uninstalled, permission revoked, profile wiped. Those rows are
 * deleted rather than retried, otherwise the table fills with endpoints that
 * can never succeed again.
 */
import webpush from "web-push";

function json(body, status) {
  return new Response(JSON.stringify(body), {
    status: status || 200,
    headers: { "Content-Type": "application/json" },
  });
}

export default async (req) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const writeKey = (process.env.PRODUCTS_WRITE_KEY || "").trim();
  const got = (req.headers.get("x-write-key") || "").trim();
  if (!writeKey || !got || got !== writeKey) return json({ error: "Not authorized." }, 401);

  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT || "mailto:farmhousegetaways@gmail.com";
  if (!publicKey || !privateKey) {
    return json({ error: "Push is not configured (VAPID keys missing)." }, 503);
  }

  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) return json({ error: "Supabase is not configured." }, 503);

  let body;
  try { body = await req.json(); } catch { return json({ error: "Bad request" }, 400); }
  const { entityId, title, url, tag } = body || {};
  if (!entityId || !title) return json({ error: "Need entityId and title." }, 400);
  // Callers say whether this is worth waking a phone for. Default no: most
  // of what this sends is a queue that can wait for the next glance.
  const urgent = body.urgent === true;

  const headers = {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    "Content-Type": "application/json",
  };

  // Who owns this stand?
  const entRes = await fetch(
    `${supabaseUrl}/rest/v1/entities?id=eq.${encodeURIComponent(entityId)}&select=owner_id,name`,
    { headers }
  );
  const entities = entRes.ok ? await entRes.json().catch(() => []) : [];
  const owner = entities[0]?.owner_id;
  if (!owner) return json({ error: "No such entity." }, 404);

  const subRes = await fetch(
    `${supabaseUrl}/rest/v1/push_subscriptions?user_id=eq.${owner}&select=id,endpoint,p256dh,auth`,
    { headers }
  );
  const subs = subRes.ok ? await subRes.json().catch(() => []) : [];
  if (!subs.length) return json({ ok: true, sent: 0, note: "Nobody has turned notifications on yet." });

  webpush.setVapidDetails(subject, publicKey, privateKey);

  const payload = JSON.stringify({
    title,
    body: body.body || "",
    url: url || "/entities",
    tag: tag || "farmgirl",
    urgent,
    at: Date.now(),
  });

  let sent = 0;
  const dead = [];
  await Promise.all(subs.map(async (s) => {
    try {
      await webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        payload,
        {
          /* THIS is why notifications took ten or fifteen minutes to arrive.
           *
           * Web Push defaults to "normal" urgency, and a push service is
           * entitled to hold a normal message until the phone next wakes on
           * its own - which on a phone in someone's pocket, in doze, is
           * exactly that sort of delay. "high" tells FCM and APNs to deliver
           * now and wake the device to do it.
           *
           * Reserve it for things that are actually urgent. Mark everything
           * high and the platforms start ignoring it - and the battery cost
           * lands on the person you are trying to help.
           */
          urgency: urgent ? "high" : "normal",
          /* How long the push service may keep trying if the phone is off.
           * An alert about a stand being down is worthless an hour later -
           * by then it is either fixed or the owner has driven out. Better
           * to drop it than to buzz at midnight about something that
           * resolved at teatime. */
          TTL: urgent ? 900 : 86400,
        }
      );
      sent++;
    } catch (err) {
      const code = err?.statusCode;
      if (code === 404 || code === 410) dead.push(s.id);
    }
  }));

  if (dead.length) {
    await fetch(
      `${supabaseUrl}/rest/v1/push_subscriptions?id=in.(${dead.join(",")})`,
      { method: "DELETE", headers }
    ).catch(() => {});
  }

  // Only the rows that actually took a message get their timestamp moved.
  if (sent) {
    const live = subs.filter((s) => !dead.includes(s.id)).map((s) => s.id);
    if (live.length) {
      await fetch(`${supabaseUrl}/rest/v1/push_subscriptions?id=in.(${live.join(",")})`, {
        method: "PATCH", headers,
        body: JSON.stringify({ last_used_at: new Date().toISOString() }),
      }).catch(() => {});
    }
  }

  return json({ ok: true, sent, removed: dead.length });
};
