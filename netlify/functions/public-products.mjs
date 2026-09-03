/**
 * GET /.netlify/functions/public-products?entity=<entity_id>
 *   -> { products: [{ id, name, variantGroup, variantLabel, keywords,
 *        category, price, photoUrl }, ...] }
 *
 * The public read side of the products table (see supabase/migrations/
 * 0005_products.sql). No sign-in — this is what a checkout kiosk with
 * nobody logged in reads pricing from, the same way mbm-checkout's own
 * /api/catalog used to before its catalog moved here. Deliberately NOT an
 * RLS policy on the table itself ("this entity's catalog is world-
 * readable" is easy to get wrong and hard to audit) — this function is
 * the one place that public exposure is decided, and it explicitly
 * selects only customer-safe columns. cost, sku, and stock_qty never
 * leave this function, on purpose: a kiosk client is public, unauthenticated
 * code running in a customer's browser, and margin isn't for them to see.
 *
 * Uses the service_role key (bypasses RLS) because there's no signed-in
 * user here to satisfy the owner-only RLS policy — entity_id in the query
 * string is the only scoping, same trust model as mbm-checkout's old
 * public /api/catalog.
 */

function json(body, status) {
  return new Response(JSON.stringify(body), {
    status: status || 200,
    headers: { "Content-Type": "application/json" },
  });
}

export default async (req) => {
  if (req.method !== "GET") return json({ error: "Method not allowed" }, 405);

  const url = new URL(req.url);
  const entityId = url.searchParams.get("entity");
  if (!entityId) return json({ error: "Missing ?entity=" }, 400);

  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) return json({ error: "Server not configured" }, 500);

  const cols = "id,name,variant_group,variant_label,keywords,category,price,photo_url";
  const query = `${supabaseUrl}/rest/v1/products?entity_id=eq.${encodeURIComponent(entityId)}&is_archived=eq.false&select=${cols}&order=name.asc`;

  let res;
  try {
    res = await fetch(query, {
      headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
    });
  } catch (err) {
    return json({ error: "Could not reach the database: " + (err?.message || err) }, 502);
  }
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    return json({ error: `Database error (${res.status}): ${detail}` }, 502);
  }

  const rows = await res.json();
  const products = rows.map((r) => ({
    id: r.id,
    name: r.name,
    variantGroup: r.variant_group,
    variantLabel: r.variant_label,
    keywords: r.keywords || [],
    category: r.category,
    price: Number(r.price),
    photoUrl: r.photo_url,
  }));

  return json({ products });
};
