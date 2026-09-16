-- A count saves whether or not there's an account to post it into
-- (16 Sep 2026, Cory: "Daily count: Not saving entries").
--
-- Mini Barn Market has no financial account on it, so every close-out hit
-- the "Choose the account the money goes into." exception in 0011 and the
-- day was lost. The count is worth keeping on its own - it is what Trends
-- reads - so a missing account now just means nothing posts to the ledger.
-- Add an account later and re-saving the day posts it then.
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

  if p_account is not null and v_sales > 0 then
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

  if p_account is not null and p_record_cost and v_cost > 0 then
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

grant execute on function save_daily_count(uuid, date, uuid, boolean, jsonb) to authenticated;
