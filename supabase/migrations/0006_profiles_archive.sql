-- Lets an admin archive a member row on the /admin Members screen (hide
-- it from the main list without deleting it — still fully recoverable).
-- Deliberately a separate flag from subscription status: archiving is a
-- housekeeping/visibility decision for the admin's own list, not a
-- billing state, so it doesn't touch the subscriptions table at all.

alter table profiles add column is_archived boolean not null default false;

-- Same shape as "subscriptions: admin can write any row" in
-- 0003_admin.sql — an admin's own logged-in session (not a backend key)
-- can flip this. Combines via OR with the existing "user can read/update
-- own row" policy from 0001_init.sql, so this only ever widens who can
-- write, never narrows the member's own access to their own row.
create policy "profiles: admin can update any row"
  on profiles for update
  using (is_admin())
  with check (is_admin());
