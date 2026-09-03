-- Product catalog per entity — e.g. Mini Barn Market's farmstand items.
-- This is what a checkout kiosk (a separate app, FarmhouseGetaways/
-- mbm-checkout) reads pricing from, and what the future profit-analysis
-- and inventory features are built against. Cost lives here so margin can
-- be computed per product without a second system to keep in sync.
--
-- variant_group/variant_label exist for the case a single spoken word is
-- genuinely ambiguous — "honey" could mean any of several actual jar
-- sizes. Products sharing a variant_group are the set a kiosk should ask
-- the customer to pick between rather than silently guess; keywords are
-- extra aliases (beyond the product name itself) worth matching a
-- customer's words against, e.g. "honey" as an alias for a specific
-- "Buckwheat Honey — 12oz" row.

create table products (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid not null references entities(id) on delete cascade,
  name text not null,
  variant_group text,
  variant_label text,
  keywords text[] not null default '{}',
  category text,
  price numeric(10,2) not null check (price >= 0),
  cost numeric(10,2) check (cost is null or cost >= 0),
  sku text,
  stock_qty numeric(10,2),
  photo_url text,
  is_archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index products_entity_idx on products (entity_id) where not is_archived;

alter table products enable row level security;

create policy "products: via owned entity"
  on products for all
  using (entity_id in (select id from entities where owner_id = auth.uid()))
  with check (entity_id in (select id from entities where owner_id = auth.uid()));

-- Public read of a product catalog (a checkout kiosk has no logged-in
-- user) is deliberately NOT an RLS policy on this table — that would mean
-- teaching Postgres "entity X's catalog is world-readable," which is easy
-- to get wrong and hard to audit later. Instead it's mediated entirely by
-- a Netlify Function (public-products.mjs) using the service_role key,
-- which explicitly selects only customer-safe columns (never cost, sku,
-- or stock_qty) for one entity_id at a time. RLS above stays strict:
-- only a signed-in owner can read or write their own entity's rows.
