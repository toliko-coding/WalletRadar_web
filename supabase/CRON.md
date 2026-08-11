# Scheduling the discovery/analysis jobs (System A, §23-26)

`pg_cron` (via Supabase Cron) runs *inside* your Postgres project and can only
reach a public HTTP URL — it cannot call `localhost`. That means this can't be
wired up until the app is deployed somewhere with a real URL. Until then, run
the two jobs manually from `/discover` in the app, or `curl` the routes
directly:

```bash
curl -X POST http://localhost:3000/api/jobs/discover-wallets
curl -X POST http://localhost:3000/api/jobs/analyze-candidates -H 'Content-Type: application/json' -d '{"limit": 10}'
```

## Once deployed

1. Set `INTERNAL_JOB_SECRET` in your deployment's environment to a real random
   value (it's optional locally — see `src/lib/jobs/auth.ts` — but required
   once these routes are reachable from the internet).
2. In the Supabase SQL Editor, enable the extensions Cron needs and schedule
   both jobs. The spec's default is every 5 hours for discovery/scoring
   (§24/§54) — this is *only* about discovery and batch re-scoring; real-time
   wallet-transaction monitoring (Phase 1G) and Demo position pricing are
   separate, much shorter intervals and are not scheduled here.

```sql
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule(
  'discover-wallets-every-5h',
  '0 */5 * * *',
  $$
  select net.http_post(
    url := 'https://YOUR-DEPLOYED-DOMAIN/api/jobs/discover-wallets',
    headers := jsonb_build_object('x-job-secret', 'YOUR_INTERNAL_JOB_SECRET')
  );
  $$
);

select cron.schedule(
  'analyze-candidates-every-5h',
  '15 */5 * * *', -- offset 15 min after discovery so there's something to analyze
  $$
  select net.http_post(
    url := 'https://YOUR-DEPLOYED-DOMAIN/api/jobs/analyze-candidates',
    headers := jsonb_build_object('x-job-secret', 'YOUR_INTERNAL_JOB_SECRET'),
    body := jsonb_build_object('limit', 25)
  );
  $$
);
```

3. Verify with `select * from cron.job;` and check `job_runs` in the app's
   database for `discover-wallets` / `analyze-candidate-wallets` rows
   appearing every 5 hours.

## Unschedule

```sql
select cron.unschedule('discover-wallets-every-5h');
select cron.unschedule('analyze-candidates-every-5h');
```
