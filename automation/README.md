# Automatic Evidence Collection — local automation runner

A local-only poll loop that keeps strategy ticks, wallet discovery, and
candidate analysis running unattended while `next dev`/`next start` is up —
outside the Next.js process, so dev-server reloads/HMR/multiple server
instances can never accidentally spin up more than one scheduler.

Not a deployment story: this never targets anything but `127.0.0.1`, has no
auth product, and does not trade real money.

## Setup (one-time)

Set `INTERNAL_JOB_SECRET` in `.env.local` to any non-empty value. The runner
refuses to start without it — every job/status/heartbeat call it makes sends
this as the `x-job-secret` header. It is never written to the lock file, the
log file, or any API response body, and no `NEXT_PUBLIC_*` version of it
exists.

Optional overrides (all have working defaults — see `automation/config.ts`):

| Env var | Default | Meaning |
|---|---|---|
| `AUTOMATION_API_BASE_URL` | `http://127.0.0.1:3000` | Must be a loopback host (`127.0.0.1`/`localhost`/`::1`) — anything else is rejected at startup. |
| `AUTOMATION_TICK_INTERVAL_MINUTES` | `15` | How often active strategies are ticked. |
| `AUTOMATION_DISCOVERY_INTERVAL_HOURS` | `6` | How often wallet discovery runs. |
| `AUTOMATION_ANALYZE_INTERVAL_HOURS` | `6` | How often candidate analysis runs. |
| `AUTOMATION_ANALYZE_BATCH_SIZE` | `10` | Wallets per candidate-analysis run. |
| `AUTOMATION_EXPENSIVE_JOB_DAILY_BUDGET` | `500` | Self-imposed operational safety budget (not Birdeye's real quota) gating discovery/analyze only — ticks are never gated by it. |
| `AUTOMATION_POLL_INTERVAL_SECONDS` | `60` | How often the runner wakes up to check what's due. |

## Usage

```
npm run automation:start   # spawns the detached runner, prints its PID
npm run automation:status  # local lock-file state + best-effort DB heartbeat
npm run automation:stop    # graceful SIGTERM, waits for the current cycle to finish
```

`next dev` (or `next start`) must be running for any job to actually
execute — the runner has no other way to reach the app's business logic. If
the app is unreachable, the runner logs the failure and waits for the next
poll; it never fabricates a result or tries to "catch up."

`start` refuses if a live, matching runner is already found (checked via the
local lock file + PID liveness + a `ps` command-string match — never the DB
heartbeat, since the runner can be correctly alive while the app is briefly
unreachable). `stop` never force-kills in-flight work: a genuinely hung
process is a separate, manual `kill -9`, not something this command does
automatically.

Runner output goes to `automation/runner.log` (gitignored, alongside the
`.runner.lock` state file).

## Surviving a Mac restart

Not built in this phase. If you want the runner to come back automatically
after a reboot or crash, a `launchd` `plist` that runs
`npm run automation:start` (or invokes `automation/cli.ts` directly) on
login is a reasonable next step — but that's a config file you'd write and
install yourself; nothing here creates or manages one.

## What it does not do

- Never bypasses the existing Birdeye/Helius rate limiter or price cache.
- Never backfills or fabricates observations for downtime (sleep, a closed
  app, a crashed runner) — every "is X due" check re-derives from the app's
  own persisted `job_runs` state, so a gap simply makes the next check due,
  never a burst of catch-up runs.
- Never runs candidate analysis/discovery past the configured expensive-job
  budget for the day (a start gate, not a mid-job hard stop — see
  `src/lib/automation/scheduling.ts`).
