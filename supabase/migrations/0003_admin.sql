-- Admin capability: subscription management only. Admins can see every
-- member's signup + subscription status and flip it manually (comping an
-- account, fixing a stuck payment). They deliberately get NO access to any
-- member's entities/accounts/transactions - those stay owner-only.

alter table profiles add column is_admin boolean not null default false;

-- is_admin can only ever be set directly in the SQL editor (or by another
-- migration), never through the app - this closes off self-escalation via
-- the existing "user can update own row" policy on profiles, which would
-- otherwise let any signed-in user flip their own is_admin to true.
revoke update (is_admin) on profiles from authenticated;

-- security definer so this bypasses RLS on its own lookup - without that,
-- a policy that queries profiles from within a profiles policy needs care
-- to avoid recursive evaluation. This is the standard Supabase pattern.
create function is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select p.is_admin from profiles p where p.id = auth.uid()), false);
$$;

create policy "profiles: admin can read all rows"
  on profiles for select
  using (is_admin());

create policy "subscriptions: admin can read all rows"
  on subscriptions for select
  using (is_admin());

-- Separate from the webhook's service_role writes - this is what lets an
-- admin's own logged-in session (via the app, not a backend key) manually
-- activate/deactivate a member from the /admin screen.
create policy "subscriptions: admin can write any row"
  on subscriptions for all
  using (is_admin())
  with check (is_admin());
