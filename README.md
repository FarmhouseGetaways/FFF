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

## Payments (Stripe)

Access to `/entities` is gated on having a row in the `subscriptions` table
with `status = 'active'`. That table is written only by the webhook handler
(via the service role key) — never by the client, never by RLS-permitted
writes — so the only way in is a real Stripe event.

- `netlify/functions/create-checkout-session.js` — authenticates the caller
  against Supabase, creates a Stripe Checkout session for the subscription
  price, returns its URL for the frontend to redirect to.
- `netlify/functions/stripe-webhook.js` — verifies Stripe's signature by hand
  (HMAC-SHA256, no SDK dependency) against the raw request body, then upserts
  `subscriptions` keyed on `user_id` for `checkout.session.completed` and
  `customer.subscription.*` events. Idempotent by design since Stripe doesn't
  guarantee exactly-once delivery.

Both functions read these Netlify environment variables (server-side only —
none of these are `VITE_`-prefixed, so they never reach the browser bundle):

| Variable | Where it comes from |
|---|---|
| `STRIPE_SECRET_KEY` | Stripe Dashboard → Developers → API keys |
| `STRIPE_PRICE_ID` | The recurring Price object for the $27/mo plan |
| `STRIPE_WEBHOOK_SECRET` | Signing secret from the webhook endpoint registered at `<site>/.netlify/functions/stripe-webhook` |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Project Settings → API (bypasses RLS — never expose client-side) |

Always develop and test against **Stripe test mode** keys first. Switching to
live keys later is just swapping these same env vars — do that directly in
the Netlify dashboard when the time comes, not by pasting live secret keys
into chat.

## Deploying

The site is built on Netlify from this repo (`netlify.toml` sets the build command
and publish directory). Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` as
Netlify environment variables (Site settings → Environment variables) — the anon key
is safe to expose client-side, it's what RLS is for.

## CSV import

`/entities/:id/import` ([src/pages/ImportCsv.jsx](src/pages/ImportCsv.jsx)) — upload any
bank or Venmo CSV export. Column mapping (date/description/amount, or separate
debit/credit columns) is auto-guessed from the header row via
[src/lib/csvImport.js](src/lib/csvImport.js), same file that suggests a category per row
by matching the description against a merchant/keyword dictionary and this entity's
actual category names. All rule-based, not a model call — free, instant, but review the
suggestions before importing. Rows matching an existing transaction's date+amount on the
same account are flagged as likely duplicates and unchecked by default.

## Receipt attachments

Transactions (income/expense, not transfers) can carry a photo or PDF, uploaded to a
private Supabase Storage bucket (`transaction-attachments`) and served only via
short-lived signed URLs — see migration `0004_attachments.sql`. On mobile the file input
opens the camera or photo library.

## Roadmap (not built yet, staged deliberately)

1. **Live bank connections (Plaid)** — deferred until there are paying users, because
   Plaid's actual per-account cost isn't knowable until you apply for production access,
   and it bills per connected account, not per user. Multi-entity users will likely
   connect multiple accounts, so this needs real usage data before committing to it at
   a $27/mo price point.
2. **Multi-user per entity** — currently one owner per entity. Sharing an entity with
   a bookkeeper/co-owner would need a membership table and updated RLS policies.
