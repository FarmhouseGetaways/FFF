/**
 * GET /.netlify/functions/admin-export
 *   headers: x-backup-key: BACKUP_KEY
 *   -> { takenAt, project, tables: { <table>: [...rows] }, counts: {...} }
 *
 * A complete logical copy of the database, for a backup that lives somewhere
 * Cory controls.
 *
 * WHY THIS EXISTS. The free tier has no automatic backups at all, so for most
 * of this project's life the only copy of Carissa's books and The Coop's
 * books has been the live database. Supabase Pro adds daily backups kept for
 * seven days, which is a real improvement and still leaves both copies inside
 * one vendor account - a billing lapse, a suspension or a lost login takes
 * the database and its backups together.
 *
 * WHY JSON AND NOT pg_dump. There is no Postgres client and no Node on the
 * machine this is driven from, and a Netlify function cannot shell out to
 * pg_dump either. For a database this size a logical export over PostgREST is
 * a perfectly good backup: it carries every row, it is readable without any
 * tooling in fifty years, and it restores with an insert per table. What it
 * does NOT carry is schema, policies, functions or triggers - those live in
 * supabase/migrations/ in this repo, which is itself the schema backup. The
 * two together are a full restore; either alone is not. Said plainly here
 * because a backup whose limits are undocumented gets trusted for things it
 * cannot do.
 *
 * SERVER-TO-SERVER, NOT A USER SESSION. A scheduled pull has no browser and
 * no signed-in admin to borrow a token from, so the door is a shared secret
 * in BACKUP_KEY rather than the is_admin() check admin-fleet uses. The key IS
 * the credential and it reads everything, so it is a long random string, it
 * lives only in Netlify's env and in the machine running the pull, and it is
 * worth rotating if a laptop ever goes missing.
 */
const TABLES = [
  "profiles",
  "entities",
  "financial_accounts",
  "categories",
  "transactions",
  "subscriptions",
  "products",
  "push_subscriptions",
  "pos_requests",
  "daily_closeouts",
  "daily_count_lines",
];

/* PostgREST caps a response; ask in pages so a growing ledger cannot quietly
   start truncating the backup. This is the failure that would be discovered
   at restore time, which is the worst possible moment. */
const PAGE = 1000;

function json(body, status) {
  return new Response(JSON.stringify(body), {
    status: status || 200,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

async function fetchAll(supabaseUrl, headers, table) {
  const rows = [];
  for (let from = 0; ; from += PAGE) {
    const res = await fetch(
      `${supabaseUrl}/rest/v1/${table}?select=*&order=id.asc&offset=${from}&limit=${PAGE}`,
      { headers }
    );
    if (!res.ok) throw new Error(`${table}: HTTP ${res.status}`);
    const page = await res.json();
    rows.push(...page);
    if (page.length < PAGE) return rows;
  }
}

export default async (req) => {
  if (req.method !== "GET") return json({ error: "Method not allowed" }, 405);

  const want = (process.env.BACKUP_KEY || "").trim();
  const got = (req.headers.get("x-backup-key") || "").trim();
  if (!want) return json({ error: "Backups are not configured (BACKUP_KEY is unset)." }, 503);
  if (!got || got !== want) return json({ error: "Not authorized." }, 401);

  const supabaseUrl = (process.env.VITE_SUPABASE_URL || "").trim().replace(/\/+$/, "");
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) return json({ error: "Supabase is not configured." }, 503);

  const headers = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` };

  const tables = {};
  const counts = {};
  const failed = {};
  for (const t of TABLES) {
    try {
      const rows = await fetchAll(supabaseUrl, headers, t);
      tables[t] = rows;
      counts[t] = rows.length;
    } catch (err) {
      /* One unreadable table must not throw away the ten that did read -
         a partial backup clearly marked partial beats no backup at all. */
      failed[t] = String((err && err.message) || err);
    }
  }

  return json({
    takenAt: new Date().toISOString(),
    project: supabaseUrl,
    complete: Object.keys(failed).length === 0,
    counts,
    failed: Object.keys(failed).length ? failed : undefined,
    schemaNote: "Schema, RLS policies and functions are NOT in this file - they are in supabase/migrations/ in the farmgirl-books repo. A restore needs both.",
    tables,
  });
};
