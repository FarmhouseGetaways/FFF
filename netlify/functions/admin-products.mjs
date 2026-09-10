/**
 * POST   /.netlify/functions/admin-products              -> create a product
 * PUT    /.netlify/functions/admin-products               -> update by id
 * DELETE /.netlify/functions/admin-products?id=...        -> archive by id
 *   body/query always needs entityId (create) or the row's own id
 *   (update/delete) — see supabase/migrations/0005_products.sql.
 *
 * Two ways in, both end up writing via the service_role key (bypasses
 * RLS) so either caller shape works without duplicating this function:
 *
 *   1. A signed-in Farmgirl Finance user — `Authorization: Bearer <token>`,
 *      the normal case once there's a Products page in the app itself.
 *      Verified against Supabase, then checked that they actually own the
 *      entity being written to (never trust entityId from the client
 *      alone for this path).
 *   2. A server-to-server caller holding PRODUCTS_WRITE_KEY — `x-write-key`
 *      header. This is mbm-checkout's own /catalog admin tool (gated
 *      there by its own CHECKOUT_ADMIN_PASSWORD), which has no Farmgirl
 *      Finance user session of its own. Trusted directly since the key
 *      itself is the credential — same shape as the CHECKOUT_LOG_KEY
 *      bridge between mbm-checkout and the Farmhouse Getaways app.
 *
 * DELETE is a soft delete (is_archived = true), not a row delete — keeps
 * history for anything that already referenced this product (a past
 * checkout log line, an existing cart) instead of orphaning it.
 */

function json(body, status) {
  return new Response(JSON.stringify(body), {
    status: status || 200,
    headers: { "Content-Type": "application/json" },
  });
}

async function authorize(req, supabaseUrl, anonKey, serviceKey) {
  const writeKey = (process.env.PRODUCTS_WRITE_KEY || "").trim();
  const gotWriteKey = (req.headers.get("x-write-key") || "").trim();
  if (writeKey && gotWriteKey && gotWriteKey === writeKey) {
    return { ok: true, ownerId: null }; // server-to-server: entity ownership isn't this caller's concern
  }

  const authHeader = req.headers.get("authorization") || "";
  const token = authHeader.replace(/^Bearer\s+/i, "");
  if (!token) return { ok: false };

  const userRes = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: { Authorization: `Bearer ${token}`, apikey: anonKey },
  });
  if (!userRes.ok) return { ok: false };
  const user = await userRes.json();
  return { ok: true, ownerId: user?.id || null };
}

async function ownsEntity(supabaseUrl, serviceKey, ownerId, entityId) {
  if (!ownerId) return true; // write-key path already trusted above
  const res = await fetch(
    `${supabaseUrl}/rest/v1/entities?id=eq.${encodeURIComponent(entityId)}&owner_id=eq.${encodeURIComponent(ownerId)}&select=id`,
    { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` } }
  );
  if (!res.ok) return false;
  const rows = await res.json();
  return rows.length > 0;
}

export default async (req) => {
  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  const anonKey = process.env.VITE_SUPABASE_ANON_KEY;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !anonKey || !serviceKey) return json({ error: "Server not configured" }, 500);

  const auth = await authorize(req, supabaseUrl, anonKey, serviceKey);
  if (!auth.ok) return json({ error: "Sign in first." }, 401);

  if (req.method === "POST") {
    let body;
    try { body = await req.json(); } catch { return json({ error: "Bad request" }, 400); }
    if (!body?.entityId || !body?.name || !(Number(body.price) >= 0)) {
      return json({ error: "entityId, name, and a price of zero or more are required." }, 400);
    }
    if (!(await ownsEntity(supabaseUrl, serviceKey, auth.ownerId, body.entityId))) {
      return json({ error: "Not your entity." }, 403);
    }
    const row = {
      entity_id: body.entityId,
      name: String(body.name).trim(),
      variant_group: body.variantGroup ? String(body.variantGroup).trim() : null,
      variant_label: body.variantLabel ? String(body.variantLabel).trim() : null,
      keywords: Array.isArray(body.keywords) ? body.keywords.map(String) : [],
      category: body.category ? String(body.category).trim() : null,
      price: Number(body.price),
      cost: body.cost !== undefined && body.cost !== null && body.cost !== "" ? Number(body.cost) : null,
      sku: body.sku ? String(body.sku).trim() : null,
      stock_qty: body.stockQty !== undefined && body.stockQty !== null && body.stockQty !== "" ? Number(body.stockQty) : null,
      photo_url: body.photoUrl || null,
    };
    const res = await fetch(`${supabaseUrl}/rest/v1/products`, {
      method: "POST",
      headers: {
        apikey: serviceKey, Authorization: `Bearer ${serviceKey}`,
        "Content-Type": "application/json", Prefer: "return=representation",
      },
      body: JSON.stringify(row),
    });
    if (!res.ok) return json({ error: "Database error: " + (await res.text().catch(() => res.status)) }, 502);
    const [created] = await res.json();
    return json({ product: created }, 201);
  }

  if (req.method === "PUT") {
    let body;
    try { body = await req.json(); } catch { return json({ error: "Bad request" }, 400); }
    if (!body?.id) return json({ error: "Missing id" }, 400);

    const existingRes = await fetch(
      `${supabaseUrl}/rest/v1/products?id=eq.${encodeURIComponent(body.id)}&select=entity_id`,
      { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` } }
    );
    const [existing] = existingRes.ok ? await existingRes.json() : [];
    if (!existing) return json({ error: "Not found" }, 404);
    if (!(await ownsEntity(supabaseUrl, serviceKey, auth.ownerId, existing.entity_id))) {
      return json({ error: "Not your entity." }, 403);
    }

    const patch = { updated_at: new Date().toISOString() };
    if (body.name !== undefined) patch.name = String(body.name).trim();
    if (body.variantGroup !== undefined) patch.variant_group = body.variantGroup ? String(body.variantGroup).trim() : null;
    if (body.variantLabel !== undefined) patch.variant_label = body.variantLabel ? String(body.variantLabel).trim() : null;
    if (body.keywords !== undefined) patch.keywords = Array.isArray(body.keywords) ? body.keywords.map(String) : [];
    if (body.category !== undefined) patch.category = body.category ? String(body.category).trim() : null;
    if (body.price !== undefined) patch.price = Number(body.price);
    if (body.cost !== undefined) patch.cost = body.cost === null || body.cost === "" ? null : Number(body.cost);
    if (body.sku !== undefined) patch.sku = body.sku ? String(body.sku).trim() : null;
    if (body.stockQty !== undefined) patch.stock_qty = body.stockQty === null || body.stockQty === "" ? null : Number(body.stockQty);
    if (body.photoUrl !== undefined) patch.photo_url = body.photoUrl || null;

    const res = await fetch(`${supabaseUrl}/rest/v1/products?id=eq.${encodeURIComponent(body.id)}`, {
      method: "PATCH",
      headers: {
        apikey: serviceKey, Authorization: `Bearer ${serviceKey}`,
        "Content-Type": "application/json", Prefer: "return=representation",
      },
      body: JSON.stringify(patch),
    });
    if (!res.ok) return json({ error: "Database error: " + (await res.text().catch(() => res.status)) }, 502);
    const [updated] = await res.json();
    return json({ product: updated });
  }

  if (req.method === "DELETE") {
    const url = new URL(req.url);
    const id = url.searchParams.get("id");
    if (!id) return json({ error: "Missing id" }, 400);

    const existingRes = await fetch(
      `${supabaseUrl}/rest/v1/products?id=eq.${encodeURIComponent(id)}&select=entity_id`,
      { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` } }
    );
    const [existing] = existingRes.ok ? await existingRes.json() : [];
    if (!existing) return json({ error: "Not found" }, 404);
    if (!(await ownsEntity(supabaseUrl, serviceKey, auth.ownerId, existing.entity_id))) {
      return json({ error: "Not your entity." }, 403);
    }

    const res = await fetch(`${supabaseUrl}/rest/v1/products?id=eq.${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ is_archived: true, updated_at: new Date().toISOString() }),
    });
    if (!res.ok) return json({ error: "Database error: " + (await res.text().catch(() => res.status)) }, 502);
    return json({ ok: true });
  }

  return json({ error: "Method not allowed" }, 405);
};
