-- Vendors, markup and the daily count (14 Sep 2026).
--
-- From a tester's spreadsheet workflow, relayed by Cory: a list of what
-- each vendor sells with the wholesale and selling price (markup follows
-- from those two), then every day at close, what was ordered against what
-- sold, giving a profit and loss for the day.
--
-- Deliberately small against the existing model:
--   * vendor is one text column on products - price and cost (wholesale)
--     were already there. public-products.mjs selects a fixed column list,
--     so the kiosk never sees it; admin-products.mjs patches named fields
--     only, so a save from the kiosk's catalog page leaves it alone.
--   * a day's count is its own pair of tables. It touches the ledger only
--     by posting ordinary transactions (source 'daily_count') into the
--     account the owner picks, so Money, balances and the P&L graph pick it
--     up with no special cases. Sales always post (Cory: "Automatically").
--     What was paid for the order posts only when record_order_cost is on:
--     an owner who already enters vendor bills in Transactions would
--     otherwise count that cost twice.
--   * the line keeps its own name/price/cost snapshot, so changing a
--     product's price later doesn't rewrite a day that's already closed.

alter table products add column if not exists vendor text;

create table daily_closeouts (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid not null references entities(id) on delete cascade,
  close_date date not null,
  financial_account_id uuid references financial_accounts(id) on delete set null,
  record_order_cost boolean not null default false,
  sales_txn_id uuid references transactions(id) on delete set null,
  cost_txn_id uuid references transactions(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (entity_id, close_date)
);

alter table daily_closeouts enable row level security;

create policy "daily_closeouts: via owned entity"
  on daily_closeouts for all
  using (entity_id in (select id from entities where owner_id = auth.uid()))
  with check (entity_id in (select id from entities where owner_id = auth.uid()));

create table daily_count_lines (
  id uuid primary key default gen_random_uuid(),
  closeout_id uuid not null references daily_closeouts(id) on delete cascade,
  entity_id uuid not null references entities(id) on delete cascade,
  product_id uuid references products(id) on delete set null,
  product_name text not null,
  vendor text,
  ordered numeric(10,2) not null default 0 check (ordered >= 0),
  sold numeric(10,2) not null default 0 check (sold >= 0),
  price numeric(10,2) not null default 0 check (price >= 0),
  cost numeric(10,2) check (cost is null or cost >= 0),
  sort_order int not null default 0
);

create index daily_count_lines_closeout_idx on daily_count_lines (closeout_id);

alter table daily_count_lines enable row level security;

create policy "daily_count_lines: via owned entity"
  on daily_count_lines for all
  using (entity_id in (select id from entities where owner_id = auth.uid()))
  with check (entity_id in (select id from entities where owner_id = auth.uid()));

-- Posted rows are tagged so they read as "Daily count" in Transactions
-- rather than passing for something typed by hand.
alter table transactions drop constraint if exists transactions_source_check;
alter table transactions add constraint transactions_source_check
  check (source in ('manual', 'csv_import', 'venmo_csv', 'plaid', 'daily_count'));

-- Save (or re-save) one day in a single database transaction: the count,
-- its lines, and the transactions it posts. Re-saving replaces the day's
-- posted transactions rather than adding to them. security invoker, so
-- every read and write below still runs under the caller's own RLS.
create or replace function save_daily_count(
  p_entity uuid,
  p_date date,
  p_account uuid,
  p_record_cost boolean,
  p_lines jsonb
) returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_closeout daily_closeouts%rowtype;
  v_sales numeric(12,2);
  v_cost numeric(12,2);
  v_cat uuid;
  v_sales_txn uuid;
  v_cost_txn uuid;
begin
  insert into daily_closeouts (entity_id, close_date, financial_account_id, record_order_cost)
  values (p_entity, p_date, p_account, coalesce(p_record_cost, false))
  on conflict (entity_id, close_date) do update
    set financial_account_id = excluded.financial_account_id,
        record_order_cost = excluded.record_order_cost,
        updated_at = now()
  returning * into v_closeout;

  delete from transactions
   where entity_id = p_entity
     and id in (v_closeout.sales_txn_id, v_closeout.cost_txn_id);

  delete from daily_count_lines where closeout_id = v_closeout.id;

  insert into daily_count_lines
    (closeout_id, entity_id, product_id, product_name, vendor, ordered, sold, price, cost, sort_order)
  select v_closeout.id, p_entity, l.product_id, l.product_name, l.vendor,
         coalesce(l.ordered, 0), coalesce(l.sold, 0), coalesce(l.price, 0), l.cost,
         coalesce(l.sort_order, 0)
    from jsonb_to_recordset(coalesce(p_lines, '[]'::jsonb)) as l(
      product_id uuid, product_name text, vendor text,
      ordered numeric, sold numeric, price numeric, cost numeric, sort_order int
    );

  select round(coalesce(sum(sold * price), 0), 2),
         round(coalesce(sum(ordered * coalesce(cost, 0)), 0), 2)
    into v_sales, v_cost
    from daily_count_lines where closeout_id = v_closeout.id;

  if p_account is null and (v_sales > 0 or (p_record_cost and v_cost > 0)) then
    raise exception 'Choose the account the money goes into.';
  end if;

  if v_sales > 0 then
    select id into v_cat from categories
     where entity_id = p_entity and category_type = 'income' and not is_archived
       and lower(name) in ('farmstand sales', 'sales')
     order by (lower(name) = 'farmstand sales') desc
     limit 1;
    if v_cat is null then
      insert into categories (entity_id, name, category_type)
      values (p_entity, 'Sales', 'income') returning id into v_cat;
    end if;
    insert into transactions
      (entity_id, financial_account_id, category_id, txn_date, description, amount, source)
    values (p_entity, p_account, v_cat, p_date, 'Daily count - sales', v_sales, 'daily_count')
    returning id into v_sales_txn;
  end if;

  if p_record_cost and v_cost > 0 then
    v_cat := null;
    select id into v_cat from categories
     where entity_id = p_entity and category_type = 'expense' and not is_archived
       and lower(name) = 'cost of goods'
     limit 1;
    if v_cat is null then
      insert into categories (entity_id, name, category_type)
      values (p_entity, 'Cost of Goods', 'expense') returning id into v_cat;
    end if;
    insert into transactions
      (entity_id, financial_account_id, category_id, txn_date, description, amount, source)
    values (p_entity, p_account, v_cat, p_date, 'Daily count - paid for order', -v_cost, 'daily_count')
    returning id into v_cost_txn;
  end if;

  update daily_closeouts
     set sales_txn_id = v_sales_txn, cost_txn_id = v_cost_txn
   where id = v_closeout.id;

  return v_closeout.id;
end;
$$;

-- Remove a day: the count, its lines, and whatever it posted.
create or replace function delete_daily_count(p_entity uuid, p_date date)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_closeout daily_closeouts%rowtype;
begin
  select * into v_closeout from daily_closeouts
   where entity_id = p_entity and close_date = p_date;
  if not found then
    return;
  end if;
  delete from transactions
   where entity_id = p_entity
     and id in (v_closeout.sales_txn_id, v_closeout.cost_txn_id);
  delete from daily_closeouts where id = v_closeout.id;
end;
$$;

grant execute on function save_daily_count(uuid, date, uuid, boolean, jsonb) to authenticated;
grant execute on function delete_daily_count(uuid, date) to authenticated;
