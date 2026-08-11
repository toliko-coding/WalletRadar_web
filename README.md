# WalletRadar

Solana blockchain intelligence and paper-trading research platform. This repo currently
implements **Phase 1A (foundation)** and **Phase 1B (manual wallet analyzer)** — see
`docs` reference below for the full technical design and phase roadmap.

No real trading ever happens here — everything is research/analytics, and later the Demo
system is a fully virtual paper-trading simulator.

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

## Using the Manual Wallet Analyzer

Go to `/discover`, paste a real Solana wallet address into "Manual Wallet Analyzer", and
click Analyze. This calls Birdeye (`wallet/v2/pnl/*`) and Helius (Enhanced Transactions)
directly against live data and computes the WalletRadar Smart Score, positions, and a
classified trade feed. You can also visit `/wallet/<address>` directly, or hit the route
handler programmatically:

```bash
curl -X POST "http://localhost:3000/api/wallet/<address>/analyze?window=90D"
```

Every non-exact figure in the UI carries a small reliability tag (`provider`, `calculated`,
`est.`, `n/a`) — see `src/types/domain.ts` (`DataReliability`) and §50 of the design doc.
Nothing is ever fabricated; unavailable data reads "Unavailable" / "Entry estimate
unavailable" instead of a guessed number.

## Testing

```bash
npm run test    # vitest — cost basis, transaction classification, Smart Score
npm run lint
npm run build
```

## What's not built yet

Wallet discovery engine, background scoring jobs, the leaderboard, real-time webhook
monitoring, Smart Money convergence detection, and the Demo/paper-trading system are
designed (see the schema in `supabase/migrations/` and the provider interfaces in
`src/lib/providers/types.ts`) but not implemented — those are Phases 1C onward.
