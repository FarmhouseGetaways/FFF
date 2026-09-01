-- Farmgirl Books schema
-- Model: cash-basis ledger. Each transaction hits exactly one financial_account
-- (checking/savings/cash/venmo/credit_card/loan) and either a P&L category
-- (income/expense) or is one leg of a transfer (linked via transfer_group_id).
-- Account balance = opening_balance + sum(amount) for that account.
-- P&L = sum(amount) grouped by category, for rows where category_id is set.
-- Balance sheet = sum of account balances, split by account_type.

create extension if not exists "pgcrypto";

-- one row per Supabase auth user
create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  email text,
  created_at timestamptz not null default now()
);

alter table profiles enable row level security;

create policy "profiles: user can read/update own row"
  on profiles for all
  using (id = auth.uid())
  with check (id = auth.uid());

-- auto-create a profile row when someone signs up
create function handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, new.email, new.raw_user_meta_data->>'full_name');
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- entities: properties / farmstands a user tracks separately
create table entities (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  entity_type text not null default 'property'
    check (entity_type in ('property', 'farmstand', 'other')),
  created_at timestamptz not null default now()
);

alter table entities enable row level security;

create policy "entities: owner has full access"
  on entities for all
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

-- financial_accounts: bank/cash/venmo/credit-card accounts (balance sheet lines)
create table financial_accounts (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid not null references entities(id) on delete cascade,
  name text not null,
  account_type text not null
    check (account_type in ('checking', 'savings', 'cash', 'venmo', 'credit_card', 'loan', 'other_asset', 'other_liability')),
  opening_balance numeric(12,2) not null default 0,
  opening_balance_date date not null default current_date,
  is_archived boolean not null default false,
  created_at timestamptz not null default now()
);

alter table financial_accounts enable row level security;

create policy "financial_accounts: via owned entity"
  on financial_accounts for all
  using (entity_id in (select id from entities where owner_id = auth.uid()))
  with check (entity_id in (select id from entities where owner_id = auth.uid()));

-- categories: income/expense categories (P&L lines)
create table categories (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid not null references entities(id) on delete cascade,
  name text not null,
  category_type text not null check (category_type in ('income', 'expense')),
  is_archived boolean not null default false,
  created_at timestamptz not null default now()
);

alter table categories enable row level security;

create policy "categories: via owned entity"
  on categories for all
  using (entity_id in (select id from entities where owner_id = auth.uid()))
  with check (entity_id in (select id from entities where owner_id = auth.uid()));

-- transactions: the ledger. amount is signed relative to financial_account
-- (positive = increases the account's balance, negative = decreases it).
create table transactions (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid not null references entities(id) on delete cascade,
  financial_account_id uuid not null references financial_accounts(id) on delete restrict,
  category_id uuid references categories(id) on delete set null,
  transfer_group_id uuid,
  txn_date date not null,
  description text,
  amount numeric(12,2) not null,
  source text not null default 'manual'
    check (source in ('manual', 'csv_import', 'venmo_csv', 'plaid')),
  created_at timestamptz not null default now(),
  constraint category_or_transfer check (category_id is not null or transfer_group_id is not null)
);

create index transactions_entity_date_idx on transactions (entity_id, txn_date);
create index transactions_account_idx on transactions (financial_account_id);

alter table transactions enable row level security;

create policy "transactions: via owned entity"
  on transactions for all
  using (entity_id in (select id from entities where owner_id = auth.uid()))
  with check (entity_id in (select id from entities where owner_id = auth.uid()));

-- seed a sensible default chart of categories whenever a new entity is created
create function seed_default_categories()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into categories (entity_id, name, category_type) values
    (new.id, 'Rental Income', 'income'),
    (new.id, 'Farmstand Sales', 'income'),
    (new.id, 'Cleaning Fees Collected', 'income'),
    (new.id, 'Other Income', 'income'),
    (new.id, 'Repairs & Maintenance', 'expense'),
    (new.id, 'Utilities', 'expense'),
    (new.id, 'Supplies', 'expense'),
    (new.id, 'Cleaning', 'expense'),
    (new.id, 'Insurance', 'expense'),
    (new.id, 'Property Tax', 'expense'),
    (new.id, 'Mortgage / Loan Payment', 'expense'),
    (new.id, 'Marketing & Advertising', 'expense'),
    (new.id, 'Platform & Payment Processing Fees', 'expense'),
    (new.id, 'Landscaping & Grounds', 'expense'),
    (new.id, 'Other Expense', 'expense');
  return new;
end;
$$;

create trigger on_entity_created_seed_categories
  after insert on entities
  for each row execute function seed_default_categories();

-- current balance per financial account (opening balance + all posted transactions).
-- security_invoker so the view runs as the querying user and their RLS policies
-- on the underlying tables still apply.
create view account_balances
  with (security_invoker = true)
  as
  select
    fa.id as financial_account_id,
    fa.entity_id,
    fa.name,
    fa.account_type,
    fa.is_archived,
    fa.opening_balance + coalesce(sum(t.amount), 0) as balance
  from financial_accounts fa
  left join transactions t on t.financial_account_id = fa.id
  group by fa.id, fa.entity_id, fa.name, fa.account_type, fa.is_archived, fa.opening_balance;
