/**
 * GET /.netlify/functions/my-stands -> { entityIds, known }
 *
 * Which of the caller's own businesses have a checkout kiosk - a live stand,
 * or one they have ordered (a pos_request that is open or fulfilled). The POS
 * pill only shows for those (Cory, 13 Sep 2026: "if a customer/user doesn't
 * have a kiosk ordered or active, they shouldn't see the POS pill").
 *
 * Only the caller's own entity ids come back - never another business's
 * stand, and nothing about a stand beyond "this one has one".
 *
 * `known: false` means the checkout site could not be asked. The page then
 * shows POS as it always did: hiding the way into somebody's own stand
 * because of a network blip is worse than showing it to someone who has none.
 */
function json(body, status) {
  return new Response(JSON.stringify(body), {
    status: status || 200,
    headers: { "Content-Type": "application/json" },
  });
}

export default async (req) => {
  if (req.method !== "GET") return json({ error: "Method not allowed" }, 405);

  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  const anonKey = process.env.VITE_SUPABASE_ANON_KEY;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const shared = (process.env.PRODUCTS_WRITE_KEY || "").trim();
  const posUrl = (process.env.POS_URL || "https://mbm-checkout.netlify.app").replace(/\/+$/, "");
  if (!supabaseUrl || !anonKey || !serviceKey) return json({ entityIds: [], known: false });

  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return json({ error: "Sign in first." }, 401);
  const userRes = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: { Authorization: `Bearer ${token}`, apikey: anonKey },
  });
  const user = userRes.ok ? await userRes.json().catch(() => null) : null;
  if (!user?.id) return json({ error: "Sign in first." }, 401);

  const headers = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` };
  const owned = await fetch(
    `${supabaseUrl}/rest/v1/entities?owner_id=eq.${encodeURIComponent(user.id)}&select=id`,
    { headers }
  ).then((r) => (r.ok ? r.json() : [])).catch(() => []);
  const mine = new Set(owned.map((e) => e.id));
  if (!mine.size) return json({ entityIds: [], known: true });

  const ids = [...mine].map(encodeURIComponent).join(",");
  const [ordered, fleet] = await Promise.all([
    fetch(`${supabaseUrl}/rest/v1/pos_requests?entity_id=in.(${ids})&status=in.(open,fulfilled)&select=entity_id`, { headers })
      .then((r) => (r.ok ? r.json() : [])).catch(() => []),
    shared
      ? fetch(`${posUrl}/api/fleet`, { headers: { "x-write-key": shared } })
          .then((r) => (r.ok ? r.json() : null)).catch(() => null)
      : Promise.resolve(null),
  ]);

  const has = new Set(ordered.map((r) => r.entity_id));
  for (const s of fleet?.stands || []) if (s.entityId && mine.has(s.entityId)) has.add(s.entityId);

  return json({ entityIds: [...has], known: fleet !== null });
};
