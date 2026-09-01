-- Subscription gating. Deliberately a separate table rather than columns on
-- profiles: only the webhook handler (using the service_role key, which
-- bypasses RLS) should ever be able to write subscription status. Regular
-- users get a read-only policy on their own row and no write policy at all -
-- that's simpler and safer than fighting column-level RLS on profiles.
--
-- provider is tracked (not hardcoded to one processor) so switching or
-- supporting more than one later doesn't require another migration.

create table subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null check (provider in ('square', 'stripe', 'manual')),
  provider_customer_id text,
  provider_subscription_id text,
  status text not null default 'incomplete'
    check (status in ('incomplete', 'active', 'past_due', 'canceled', 'paused')),
  current_period_end timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index subscriptions_user_id_key on subscriptions (user_id);
create unique index subscriptions_provider_subscription_id_key
  on subscriptions (provider_subscription_id)
  where provider_subscription_id is not null;

alter table subscriptions enable row level security;

create policy "subscriptions: user can read own row"
  on subscriptions for select
  using (user_id = auth.uid());

-- Deliberately no insert/update/delete policy for the authenticated role:
-- webhook handlers write via the service_role key, which bypasses RLS entirely.
