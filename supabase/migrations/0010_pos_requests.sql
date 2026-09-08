-- A customer's request for another POS/checkout stand on their account.
--
-- Deliberately a REQUEST, not a self-serve provisioning trigger (Cory, 8 Sep
-- 2026, choosing between the two: "Request only, you follow up"). A stand is
-- real hardware that has to be shipped and a merchant account that has to be
-- applied for - nothing about submitting this form should look instant or
-- automatic. It lands here, the admin is pushed a notification, and the
-- actual stand still gets created by hand in mbm-checkout's /api/stands, the
-- same as every stand today.
--
-- `location_name` exists specifically to solve a naming problem raised the
-- same day: a business with two stands needs to be able to tell them apart
-- (on the pos-enter picker, and everywhere else) via something more useful
-- than "the entity's name twice." The customer names their own location at
-- the point they ask for it, which is the one moment they actually know
-- what to call it - not us guessing later.
create table pos_requests (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid not null references entities(id) on delete cascade,
  requested_by uuid not null references auth.users(id),

  location_name text not null,
  shipping_address text,
  notes text,

  status text not null default 'open' check (status in ('open', 'fulfilled', 'declined')),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table pos_requests enable row level security;

-- A customer can only ever file this against a business THEY own - checked
-- against entities directly, not trusted from the request body.
create policy "pos_requests: owner can insert for own entity"
  on pos_requests for insert
  with check (
    requested_by = auth.uid()
    and exists (select 1 from entities e where e.id = entity_id and e.owner_id = auth.uid())
  );

create policy "pos_requests: owner can read own"
  on pos_requests for select
  using (exists (select 1 from entities e where e.id = entity_id and e.owner_id = auth.uid()));

-- Same is_admin() security-definer function 0003_admin.sql already built -
-- reused rather than re-invented.
create policy "pos_requests: admin can read all"
  on pos_requests for select
  using (is_admin());

create policy "pos_requests: admin can update any"
  on pos_requests for update
  using (is_admin())
  with check (is_admin());
