/**
 * GET /.netlify/functions/admin-fleet -> { stands, usage }
 *
 * The platform's own view: every kiosk, and how much the accounting side is
 * being used. Admin only, and the admin flag is read from the database rather
 * than believed from the caller.
 *
 * WHAT IT DOES NOT RETURN, AND WHY THAT IS A DESIGN RULE RATHER THAN AN
 * OVERSIGHT. No transaction amounts, no balances, no profit, no customer
 * names, no catalog. Counts and dates only.
 *
 * Cory's line, 7 Sep 2026: "We don't want to be able to see their financials
 * or any of those types of details, but we do want to be able to customize
 * their experience." Knowing somebody entered 40 transactions last month
 * tells us they are actually using it; knowing what those transactions were
 * is their business and none of ours. The moment a support screen can read a
 * customer's books, every support session is a privacy question.
 *
 * The stands half is proxied from the checkout site, which is the only place
 * that knows about stands, using the secret the two sites already share. That
 * secret never reaches the browser.
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
  if (req.method !== "GET") return json({ error: "Method not allowed" }, 405);

  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  const anonKey = process.env.VITE_SUPABASE_ANON_KEY;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const shared = (process.env.PRODUCTS_WRITE_KEY || "").trim();
  const posUrl = (process.env.POS_URL || "https://mbm-checkout.netlify.app").replace(/\/+$/, "");
  if (!supabaseUrl || !anonKey || !serviceKey) return json({ error: "Supabase is not configured." }, 503);

  const user = await userFromToken(req, supabaseUrl, anonKey);
  if (!user) return json({ error: "Sign in first." }, 401);

  const headers = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` };
  const me = await fetch(
    `${supabaseUrl}/rest/v1/profiles?id=eq.${encodeURIComponent(user.id)}&select=is_admin`,
    { headers }
  );
  const isAdmin = me.ok && ((await me.json().catch(() => []))[0]?.is_admin === true);
  if (!isAdmin) return json({ error: "Not allowed." }, 403);

  /* Counts, never contents. `select=id` with a count header returns a number
     and no rows at all, so the amounts are not merely unread - they are never
     fetched. */
  async function countOf(path) {
    const res = await fetch(`${supabaseUrl}/rest/v1/${path}`, {
      headers: { ...headers, Prefer: "count=exact", Range: "0-0" },
    });
    const range = res.headers.get("content-range") || "";
    const total = Number(range.split("/")[1]);
    return Number.isFinite(total) ? total : 0;
  }

  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const [entities, profiles, standsRes] = await Promise.all([
    fetch(`${supabaseUrl}/rest/v1/entities?select=id,name,owner_id,created_at,is_archived`, { headers })
      .then((r) => (r.ok ? r.json() : []))
      .catch(() => []),
    fetch(`${supabaseUrl}/rest/v1/profiles?select=id,email,created_at,is_admin`, { headers })
      .then((r) => (r.ok ? r.json() : []))
      .catch(() => []),
    shared
      ? fetch(`${posUrl}/api/fleet`, { headers: { "x-write-key": shared } })
          .then((r) => (r.ok ? r.json() : null))
          .catch(() => null)
      : Promise.resolve(null),
  ]);

  // Per member: how many businesses, and how much they have entered lately.
  // One count query per member is fine at this size and stays honest - it
  // asks the database for a number rather than pulling rows and counting.
  const usage = await Promise.all(
    profiles.map(async (p) => {
      const mine = entities.filter((e) => e.owner_id === p.id);
      const ids = mine.map((e) => e.id);
      const recent = ids.length
        ? await countOf(
            `transactions?select=id&entity_id=in.(${ids.join(",")})&txn_date=gte.${since}`
          )
        : 0;
      const total = ids.length
        ? await countOf(`transactions?select=id&entity_id=in.(${ids.join(",")})`)
        : 0;
      return {
        userId: p.id,
        email: p.email,
        isAdmin: p.is_admin === true,
        joined: p.created_at,
        businesses: mine.filter((e) => !e.is_archived).length,
        transactions30d: recent,
        transactionsTotal: total,
      };
    })
  );

  // Name the businesses so a stand can be shown next to whose it is.
  const byEntity = Object.fromEntries(entities.map((e) => [e.id, e]));
  const stands = (standsRes?.stands || []).map((s) => {
    const ent = s.entityId ? byEntity[s.entityId] : null;
    const owner = ent ? profiles.find((p) => p.id === ent.owner_id) : null;
    return { ...s, businessName: ent?.name || null, ownerEmail: owner?.email || null };
  });

  return json({
    stands,
    standsReachable: standsRes !== null,
    usage: usage.sort((a, b) => b.transactions30d - a.transactions30d),
  });
};
