-- 0016 - Explicit Data API grants.
--
-- WHY: From 30 Oct 2026 Supabase stops auto-granting Data API
-- (PostgREST / supabase-js / GraphQL) access on NEW tables in `public`.
-- Existing tables on the live project keep their grants, but any rebuild
-- from these migrations (a staging project, a restore into a new project,
-- a preview branch, `supabase db reset`) would create every table with no
-- grants, and the app would get "permission denied" everywhere.
-- 0001-0015 never granted table access, so this migration does it explicitly.
--
-- SAFE TO RE-RUN: GRANT is idempotent, and re-granting a privilege that
-- already exists does nothing. RLS policies are not touched; RLS stays the
-- row-level gate. These grants only allow a role through to the table.
--
-- ANON GETS NO TABLE ACCESS. No code path queries a table signed out:
-- every browser route except / and /login is behind RequireAuth, and the
-- one public kiosk read (public-products) runs server-side as service_role.
-- anon keeps schema USAGE only, so PostgREST can resolve the schema.
-- (This migration does not REVOKE anon's existing grants on the live
-- project. See the PR for that optional hardening step.)

grant usage on schema public to anon, authenticated, service_role;

-- ---------------------------------------------------------------- tables
grant select, insert, update, delete on table
  public.entities,
  public.financial_accounts,
  public.categories,
  public.transactions,
  public.subscriptions,
  public.products,
  public.push_subscriptions,
  public.pos_requests,
  public.daily_closeouts,
  public.daily_count_lines
to authenticated, service_role;

-- profiles: 0003 meant to block self-escalation with
-- `revoke update (is_admin) on profiles from authenticated`. A column-level
-- REVOKE has no effect while the role still holds table-level UPDATE,
-- which Supabase's default grants give it. So the table-level UPDATE is
-- swapped for column-level UPDATE on the columns the app actually writes.
-- Without this, any signed-in user could set their own is_admin = true.
grant select, insert, delete on table public.profiles to authenticated;
revoke update on table public.profiles from authenticated;
grant update (full_name, email, is_archived) on table public.profiles to authenticated;
grant select, insert, update, delete on table public.profiles to service_role;

-- ----------------------------------------------------------------- views
-- account_balances is security_invoker, so callers also need SELECT on the
-- underlying tables. They get it above.
grant select on table public.account_balances to authenticated, service_role;

-- ------------------------------------------------------------- sequences
-- Every table uses uuid keys today; this covers any serial/identity column
-- added later in this schema.
grant usage, select on all sequences in schema public to authenticated, service_role;

-- ------------------------------------------------------------- functions
-- RPCs the app calls (DailyCount.jsx). Already granted in 0011/0015;
-- restated so this file is the single source of truth.
grant execute on function public.save_daily_count(uuid, date, uuid, boolean, jsonb) to authenticated;
grant execute on function public.delete_daily_count(uuid, date) to authenticated;
-- Used inside RLS policies; evaluated as the calling role.
grant execute on function public.is_admin() to authenticated, service_role;

-- ---------------------------------------------------- default privileges
-- Tables and sequences created later by `postgres` (migrations / SQL
-- editor) get the same grants automatically. Objects created by any other
-- role are NOT covered. New-table migrations should still grant explicitly
-- (see README "Every new table needs explicit grants").
alter default privileges for role postgres in schema public
  grant select, insert, update, delete on tables to authenticated, service_role;
alter default privileges for role postgres in schema public
  grant usage, select on sequences to authenticated, service_role;
