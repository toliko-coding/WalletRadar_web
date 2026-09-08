# WalletRadar

Solana blockchain intelligence and paper-trading research platform.

No real trading ever happens here — everything is research/analytics, and the Demo
system is a fully virtual paper-trading simulator (simulated fills/slippage/fees against
real market prices, no wallet-signing or on-chain transactions ever).

## Requirements

- Node.js **22+** (this repo's toolchain — Next.js 16, Tailwind v4, Vitest — targets
  Node 22; several dependencies emit `EBADENGINE` warnings on older Node but currently
  still run on 21.5+. Prefer 22 LTS to avoid surprises.)
- npm 10+
- A [Birdeye](https://bds.birdeye.so) API key
- A [Helius](https://dev.helius.xyz) API key
- (Optional for now) A [Supabase](https://supabase.com) project

Every variable is validated with Zod (`src/lib/env.ts`). Variables an active code path
actually needs (Birdeye/Helius keys, Supabase URL/publishable/secret keys) fail loudly
with a specific "X is not set, add a real value to .env.local" error the moment that code
path runs, instead of a confusing downstream fetch/auth failure. `DATABASE_URL` and
`HELIUS_WEBHOOK_AUTH_HEADER` aren't consumed by any code yet (no direct Postgres access;
webhooks are Phase 1G) so they stay optional for now.

## Setup

1. Install dependencies:
   ```bash
   npm install
   ```
2. Copy the env template and fill in real values:
   ```bash
   cp .env.example .env.local
   ```
   Set `BIRDEYE_API_KEY` and `HELIUS_API_KEY` at minimum — the Manual Wallet Analyzer
   needs both. Supabase vars are optional; without them the app runs with persistence
   silently disabled (best-effort writes are skipped).
3. Run the dev server:
   ```bash
   npm run dev
   ```
   Open http://localhost:3000 — it redirects to `/dashboard`.

## Supabase (optional, for persistence)

1. Create a project at https://supabase.com.
2. Set `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`,
   `SUPABASE_SECRET_KEY`, and `DATABASE_URL` in `.env.local`. These are Supabase's current
   API key names (publishable/secret), not the legacy anon/service_role naming.
3. Apply the schema:
   ```bash
   supabase link --project-ref <your-project-ref>
   supabase db push
   ```
   (or paste `supabase/migrations/0001_init.sql` into the SQL editor).
4. Restart the dev server. The status pills in the top bar and on `/settings` flip to
   "Configured" once the app can see real values (not the `.env.example` placeholders).

## Pages

- **`/dashboard`** — Leaderboard of discovered wallets ranked by WalletRadar Smart Score,
  with a Filters & Presets panel (5 built-in presets + Custom, URL-driven so filter state
  is shareable).
- **`/discover`** — Manual Wallet Analyzer (paste any Solana address, analyzed live
  against Birdeye/Helius), plus controls to run the discovery/batch-analysis jobs and a
  job run history table.
- **`/wallet/<address>`** — Full analysis for one wallet: Smart Score breakdown, current
  positions, classified trade history, Smart Score history chart. Reads cached Supabase
  data by default (a Refresh button re-runs live analysis on demand) so viewing a wallet
  never silently burns API quota.
- **`/smart-money`** — Smart Money convergence signals: tokens multiple tracked,
  non-bot/bundler/insider wallets bought within a rolling time window, computed
  retrospectively from already-stored trade history (not real-time monitoring yet).
- **`/demo`** — Demo/paper-trading strategies: create a strategy with convergence
  criteria and risk rules, run a tick to detect signals and simulate fills against live
  market prices (with unfavorable slippage + fees, entering only at *current* price —
  never the source wallets' historical price), track open/closed positions, equity curve,
  and compare strategies against a SOL benchmark.
- **`/settings`** — Connection status for Birdeye/Helius/Supabase.

The top bar also has a "Jump to wallet address" box for quick lookups from anywhere.

A global wallet address is looked up live only the first time it's ever viewed; every
non-exact figure in the UI carries a reliability tag (`provider`, `calculated`, `est.`,
`n/a`) — see `src/types/domain.ts` (`DataReliability`). Nothing is ever fabricated;
unavailable data reads "Unavailable" instead of a guessed number.

## Running the background jobs

Discovery, batch analysis, and Demo strategy ticks are all triggered manually today (from
`/discover` and `/demo`, or via `curl`) — see `supabase/CRON.md` for wiring them up to
`pg_cron` once the app is deployed somewhere with a public URL (Supabase Cron can't reach
`localhost`).

```bash
curl -X POST "http://localhost:3000/api/wallet/<address>/analyze?window=90D"
curl -X POST http://localhost:3000/api/jobs/discover-wallets
curl -X POST http://localhost:3000/api/jobs/analyze-candidates -H 'Content-Type: application/json' -d '{"limit": 10}'
curl -X POST http://localhost:3000/api/demo/strategies/<id>/tick
```

## Testing

```bash
npm run test    # vitest — cost basis, classification, Smart Score, convergence, Demo engine, presets
npm run lint
npm run build
```

## What's not built yet

- **Auth** — deliberately deferred; every route is currently open, single-tenant.
- **Real-time monitoring (Phase 1G)** — webhook-driven live convergence detection instead
  of the current retrospective/on-request computation; needs a deployment or public
  tunnel to receive Helius webhooks.
- **BTC benchmark** — only a SOL benchmark exists (`src/lib/demo/benchmarks.ts`); adding
  BTC needs a non-Solana price source (CoinGecko now requires an API key even for basic
  endpoints).
- **Multi-window analysis** — only `window_label = '90D'` has real data; other window
  options are shown in the UI with an explanatory empty state rather than fake data.
