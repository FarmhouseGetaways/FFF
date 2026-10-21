-- 0017 - Security hardening: least privilege for anon and for SECURITY DEFINER functions.
--
-- Follows 0016 (explicit Data API grants). Idempotent: REVOKE/GRANT of an
-- absent/present privilege is a no-op. RLS policies, data and other objects
-- are not touched.
--
-- 1. anon loses every table/view/sequence privilege in public, and the
--    default privileges role postgres had been handing it. Schema USAGE stays.
--    No code path in this repo queries a table signed out (signed-out pages
--    only use /auth/v1; the kiosk catalog is server-side service_role).
--    ONE EXCEPTION, kept on purpose: mbm-checkout's scheduled watchdog
--    (netlify/functions/watch-app.mjs, every 5 min) probes
--    GET /rest/v1/entities?select=id&limit=1 with the publishable key to
--    prove the database is up. anon keeps SELECT on entities.id ONLY.
--    RLS (owner_id = auth.uid()) still returns zero rows to anon, so this
--    exposes nothing; it just keeps the probe a 200 [] instead of a 401.
-- 2. EXECUTE on SECURITY DEFINER functions is limited (advisor lints 0028/0029):
--    handle_new_user / seed_default_categories are trigger-only (auth.users
--    and entities AFTER INSERT). Postgres checks trigger-function EXECUTE at
--    CREATE TRIGGER time, not when the trigger fires, so the triggers keep
--    working. is_admin() keeps authenticated + service_role: RLS policies call
--    it as the signed-in user. The daily-count RPCs keep authenticated.

-- ------------------------------------------------------------------ anon
revoke all on all tables in schema public from anon;      -- tables + views
revoke all on all sequences in schema public from anon;
grant usage on schema public to anon;
grant select (id) on table public.entities to anon;       -- watch-app.mjs probe

alter default privileges for role postgres in schema public revoke all on tables from anon;
alter default privileges for role postgres in schema public revoke all on sequences from anon;
alter default privileges for role postgres in schema public revoke all on functions from anon;

-- ------------------------------------------------------------- functions
revoke execute on function public.handle_new_user()          from public, anon, authenticated;
revoke execute on function public.seed_default_categories()  from public, anon, authenticated;
grant  execute on function public.handle_new_user()          to service_role;
grant  execute on function public.seed_default_categories()  to service_role;

revoke execute on function public.is_admin() from public, anon;
grant  execute on function public.is_admin() to authenticated, service_role;

revoke execute on function public.save_daily_count(uuid, date, uuid, boolean, jsonb) from public, anon;
revoke execute on function public.delete_daily_count(uuid, date)                     from public, anon;
grant  execute on function public.save_daily_count(uuid, date, uuid, boolean, jsonb) to authenticated, service_role;
grant  execute on function public.delete_daily_count(uuid, date)                     to authenticated, service_role;
