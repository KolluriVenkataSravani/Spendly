# Spendly

Spendly is a personal finance tracker built with React, TypeScript, Tailwind CSS, Supabase, Recharts, and Framer Motion. It tracks transactions you enter yourself; it does not connect to banks or move money.

## Requirements

- Node.js 20.19+ (or 22.12+)
- npm
- A Supabase project for sign-in and persistent data

## Run locally

```sh
npm install
cp .env.example .env
```

Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` in `.env` to the project URL and the project's publishable/anon key. These are browser-visible public project settings; never put a Supabase service-role key in a `VITE_` variable or in this app.

Apply [`supabase/migrations/202611140001_initial_schema.sql`](./supabase/migrations/202611140001_initial_schema.sql) to the Supabase project. For example, with the Supabase CLI installed and the project linked:

```sh
supabase db push
```

Alternatively, paste the migration into the Supabase SQL Editor and run it once. It creates the tables, indexes, auth trigger, private receipt bucket, invitation/expense/account RPCs, and Row Level Security policies. New sign-ups receive a profile and default categories automatically.

If you already applied the initial schema manually, also run [`supabase/migrations/202611140002_authenticated_api_grants.sql`](./supabase/migrations/202611140002_authenticated_api_grants.sql) in the SQL Editor. It grants the authenticated role the SQL privileges needed to reach the tables; Row Level Security continues to enforce row ownership and group membership.

Run subsequent migrations in numeric order as well. If group creation returns an RLS error, run [`supabase/migrations/202611140003_create_group_rpc.sql`](./supabase/migrations/202611140003_create_group_rpc.sql). Group creation then goes through a database function that assigns the signed-in user as the owner; direct group inserts remain disabled.

In the Supabase Dashboard, open **Authentication → Providers → Email** and enable email/password sign-in. Choose whether to require email confirmation (recommended for real accounts; you can turn it off temporarily for local testing). Under **Authentication → URL Configuration**, set the local Site URL to `http://localhost:5173` and add `http://localhost:5173/**` to the allowed redirect URLs. Add your production domain there too when deploying. Spendly password recovery returns to `/`.

Supabase's built-in mailer can be used to try confirmation and recovery during development, subject to its rate limits. Configure custom SMTP in Supabase for dependable delivery in production. Group invitations are not emailed: Spendly creates an expiring link that you share directly.

Then start (or restart) the app so Vite reloads the environment variables:

```sh
npm run dev
```

Without both Supabase environment variables, Spendly shows setup guidance and does not attempt authentication. Build and test with:

```sh
npm run build
npm test
```

If authentication succeeds but app data requests return HTTP 403, confirm both migrations completed successfully and that the Supabase `public` schema is exposed under **Project Settings → API → Exposed schemas**. The app displays Supabase error codes and details to help diagnose remaining policy or schema issues.

## Data and privacy

- Each account's profile, categories, transactions, budgets, and payment-source labels are protected by owner-based RLS. Group records are visible only to current members; invitations are accepted through a hashed, single-use, seven-day token and require the invited email address.
- Shared expenses and their splits are validated and created atomically by a database function. Settlements record real-world payments; Spendly never transfers funds.
- Receipts use a private Supabase Storage bucket, user-scoped object paths, and short-lived signed links. The app allows JPG, PNG, WebP, or PDF files up to 5 MB.
- Amounts are stored as PostgreSQL `numeric(14,2)` values and the app performs monetary aggregation and split allocation in integer minor units. The UI offers two-decimal currencies (INR, USD, EUR, GBP, CAD, AUD, SGD).
- The vault stores only a nickname, issuer, optional last four digits, or optional masked UPI label. Never enter full card numbers, CVVs, PINs, UPI PINs, or banking passwords.
- Account deletion removes the user's personal data and receipts. Expenses involving the departing member and related settlements are removed so the remaining group balances do not retain invalid shares; groups with remaining members are retained and ownership is reassigned.

## Current scope and configuration notes

- The application has no demo data. Every chart, total, and list is derived from the signed-in user's Supabase records.
- Core authentication, onboarding, transaction/category management, budgets, analytics, shared groups/splits/settlements, receipt uploads, Card Vault, and profile/account settings are implemented. Notifications are in-app budget/shared-balance reminders.
- Group invitations are not emailed; invitees need an account using the invited email and must sign in to accept. Supabase email delivery is separately configured for account confirmation and password recovery.
- Appearance and notification preferences beyond in-app reminders are not configurable yet. Bank integrations and payment processing are intentionally out of scope.
- Transaction history is loaded in 1,000-row API pages and presented with client-side pagination; analytics are derived from that loaded history.
