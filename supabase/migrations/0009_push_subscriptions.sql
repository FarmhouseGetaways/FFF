-- Web Push subscriptions, one row per browser/device a user has said yes on.
--
-- Added 5 Sep 2026 so the Mini Barn Market kiosk can reach a human. When a
-- customer buys something the catalog doesn't know, they say a price out
-- loud and are charged it — that's only acceptable if somebody actually
-- looks at it afterwards, and a badge nobody opens the app to see is not
-- somebody looking.
--
-- A "subscription" is what the browser's push service hands back: an
-- endpoint URL unique to that browser install, plus two keys used to
-- encrypt the payload so the push service itself can't read it.

create table push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,

  -- Unique per browser install. The same person on a phone and a laptop is
  -- two rows, and both should ring.
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,

  user_agent text,
  created_at timestamptz not null default now(),
  -- Bumped on every successful send. A subscription that has not worked in
  -- a long time is the first thing to suspect when someone says they
  -- stopped getting notifications.
  last_used_at timestamptz
);

create index push_subscriptions_user_idx on push_subscriptions (user_id);

alter table push_subscriptions enable row level security;

-- Same shape as every other table here: you can only ever see or touch your
-- own rows. The send path runs with the service role and deliberately
-- bypasses this, because it has to read other people's endpoints to deliver
-- to them.
create policy "push_subscriptions: own rows"
  on push_subscriptions for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
