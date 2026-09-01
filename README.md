# Farmgirl Books

Accounting web app for tracking farmstand/property financials — Profit & Loss and
Balance Sheet, per entity (property, farmstand, etc.), built on manually entered
transactions. Part of the Financial Freedom Farmgirl program.

## Stack

- **Frontend:** React + Vite, hosted on Netlify
- **Backend:** Supabase (Postgres + Auth). The frontend talks to Supabase directly;
  Row Level Security policies enforce that each user only ever sees their own entities.
- **Billing / bank sync:** not built yet — see Roadmap below.

## Data model

See [`supabase/migrations/0001_init.sql`](supabase/migrations/0001_init.sql). Summary:

- `entities` — a property or farmstand a user tracks. Everything below belongs to one.
- `financial_accounts` — checking/savings/cash/Venmo/credit card/loan accounts. These
  are the Balance Sheet lines.
- `categories` — income/expense categories. These are the Profit & Loss lines.
- `transactions` — the ledger. Each row posts against exactly one `financial_account`
  and either a `category` (normal income/expense) or a `transfer_group_id` (moving
  money between two of your own accounts, which nets to zero and doesn't touch P&L).

Account balance = opening balance + sum of its transactions. P&L = transactions
grouped by category over a date range. Balance Sheet = account balances split into
assets vs. liabilities, with Owner's Equity calculated as Assets − Liabilities.

## Local setup

1. Install [Node.js LTS](https://nodejs.org).
2. `npm install`
3. Copy `.env.example` to `.env` and fill in your Supabase project's URL and anon key
   (Project Settings → API in the Supabase dashboard).
4. In the Supabase dashboard, open the SQL editor and run the contents of
   `supabase/migrations/0001_init.sql` once against your project.
5. `npm run dev`

## Deploying

The site is built on Netlify from this repo (`netlify.toml` sets the build command
and publish directory). Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` as
Netlify environment variables (Site settings → Environment variables) — the anon key
is safe to expose client-side, it's what RLS is for.

## Roadmap (not built yet, staged deliberately)

1. **CSV import** — upload a bank/Venmo export and map rows into transactions, with a
   review step for miscategorized/unmatched rows. Works for any bank, no per-institution
   integration needed.
2. **Live bank connections (Plaid)** — deferred until there are paying users, because
   Plaid's actual per-account cost isn't knowable until you apply for production access,
   and it bills per connected account, not per user. Multi-entity users will likely
   connect multiple accounts, so this needs real usage data before committing to it at
   a $27/mo price point.
3. **Subscription billing (Stripe)** — needed once this moves beyond a single
   internal user. Netlify Functions will handle the checkout session + webhook (must
   be server-side to verify Stripe's signature).
4. **Multi-user per entity** — currently one owner per entity. Sharing an entity with
   a bookkeeper/co-owner would need a membership table and updated RLS policies.
