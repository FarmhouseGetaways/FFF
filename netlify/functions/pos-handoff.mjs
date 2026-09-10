/**
 * POST /.netlify/functions/pos-handoff  { entityId }  -> { url }
 *
 * One click from ivizhin into the checkout stand's admin, with no
 * second password.
 *
 * WHY THIS EXISTS. The stand's admin pages have their own password, because
 * the kiosk itself has no address bar and no keyboard - five taps in a corner
 * and a PIN is the only way in when you are standing at the machine. That was
 * fine when the only person using it was the person who set it up. It is not
 * fine as a product: an owner already signed in here should not meet a second
 * credential they were never given, and asking them to keep one is how a
 * customer ends up locked out of their own stand.
 *
 * HOW IT IS SAFE. Three things have to hold, and all three are checked here
 * rather than trusted from the browser:
 *
 *   1. The caller proves who they are with their Supabase access token,
 *      verified against Supabase - never decoded and believed.
 *   2. They must OWN the entity they are asking about. The owner_id comes
 *      from the database, not the request.
 *   3. The ticket is signed with the secret this site and the stand already
 *      share, and expires in 60 seconds. It carries an entity id and nothing
 *      else - no password, no session, nothing reusable.
 *
 * The stand verifies the signature, resolves the entity to its own stand
 * record, and mints its own short session. A leaked ticket is worth one
 * minute of access to one entity, and cannot be replayed after it expires.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

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
  const secret = (process.env.PRODUCTS_WRITE_KEY || "").trim();
  const posUrl = (process.env.POS_URL || "https://mbm-checkout.netlify.app").replace(/\/+$/, "");
  if (!supabaseUrl || !anonKey || !serviceKey) return json({ error: "Supabase is not configured." }, 503);
  if (!secret) return json({ error: "PRODUCTS_WRITE_KEY is not set, so the stand cannot be reached." }, 503);

  const user = await userFromToken(req, supabaseUrl, anonKey);
  if (!user) return json({ error: "Sign in first." }, 401);

  let body;
  try { body = await req.json(); } catch { return json({ error: "Bad request" }, 400); }
  const entityId = String(body?.entityId || "").trim();
  if (!entityId) return json({ error: "Which business?" }, 400);

  const headers = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` };

  /* A PLATFORM ADMIN MAY ENTER ANY STAND. Concierge setup is a real part of
     the offer - somebody buys the kiosk and wants their idle screen and their
     products done for them - and it cannot be done from outside. The flag is
     read from the database, never from the request, and it is the same flag
     that gates the Admin screen. Everyone else is held to what they own. */
  const me = await fetch(
    `${supabaseUrl}/rest/v1/profiles?id=eq.${encodeURIComponent(user.id)}&select=is_admin`,
    { headers }
  );
  const isAdmin = me.ok && ((await me.json().catch(() => []))[0]?.is_admin === true);

  // Ownership from the database, never from the caller.
  const res = await fetch(
    `${supabaseUrl}/rest/v1/entities?id=eq.${encodeURIComponent(entityId)}&select=id,owner_id`,
    { headers }
  );
  const rows = res.ok ? await res.json().catch(() => []) : [];
  if (!rows[0] || (!isAdmin && rows[0].owner_id !== user.id)) {
    // Same answer whether it does not exist or is not theirs - a probe should
    // not be able to map which entity ids are real.
    return json({ error: "Not your business." }, 403);
  }

  /* Is this concierge, or somebody opening their own stand? An admin working
     on a customer's stand should be told so on every screen - it is their
     shop, their wording, their prices, and changes are live the moment they
     are saved. The flag is signed along with the rest so it cannot be flipped
     in the URL, and it is decided HERE, from ownership, not asked for. */
  const concierge = isAdmin && rows[0].owner_id !== user.id;

  const exp = Date.now() + 60_000;
  const sig = createHmac("sha256", secret)
    .update(`${entityId}.${exp}.${concierge ? 1 : 0}`)
    .digest("hex");

  return json({
    url: `${posUrl}/.netlify/functions/pos-enter?e=${encodeURIComponent(entityId)}`
       + `&x=${exp}&c=${concierge ? 1 : 0}&s=${sig}`,
    expiresInSeconds: 60,
    concierge,
  });
};

// Kept for symmetry with the verifier on the stand; both sides must agree.
export const sign = (secret, entityId, exp) =>
  createHmac("sha256", secret).update(`${entityId}.${exp}`).digest("hex");

export const verify = (secret, entityId, exp, given) => {
  const want = Buffer.from(sign(secret, entityId, exp), "utf8");
  const got = Buffer.from(String(given || ""), "utf8");
  return want.length === got.length && timingSafeEqual(want, got);
};
