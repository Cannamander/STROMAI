# NWS Ingestor

Polls NWS active alerts, filters to actionable warnings (and optionally watches), upserts to `nws_alerts`, derives impacted ZIPs via PostGIS (ZCTA intersection), and upserts to `alert_impacted_zips`.

## Env vars

- **DATABASE_URL** – Postgres connection string (Supabase pooler or direct). Example:  
  `postgresql://postgres.PROJECT:PASSWORD@HOST:5432/postgres?sslmode=require`
- **NWS_BASE_URL** – Default `https://api.weather.gov`
- **NWS_USER_AGENT** – Required by NWS API (identify your app)
- **NWS_POLL_SECONDS** – Poll interval when running in poll mode (default 120)
- **NWS_STATES** – Comma-separated state codes (e.g. `TX,OK,LA`). Default `TX` if unset.
- **INCLUDE_WATCH** – Set `true` to treat “… Watch” events as actionable (default `false`)
- **DRY_RUN** – Set `true` to skip DB writes
- **LOG_LEVEL** – `info` or `debug`

## DB tables

- **public.nws_alerts** – Raw NWS alerts (actionable-only); existing schema unchanged.
- **public.alert_impacted_zips** – One row per actionable alert with derived ZIP list from PostGIS intersection with **public.zcta5_raw** (ZCTA shapes, GIST index on `geom`). Columns: `alert_id`, `event`, `headline`, `severity`, `sent`, `effective`, `expires`, `geom_present`, `zips` (text[]), `created_at`. Unique on `alert_id`; reruns upsert.

## Migrations

Run the migration once against your Supabase Postgres (e.g. SQL Editor or `psql`):

```bash
# From repo root, apply migration
psql "$DATABASE_URL" -f services/nws-ingestor/migrations/001_alert_impacted_zips.sql
```

## Commands

- **npm run nws:once** – One ingest cycle then exit. Logs one line per actionable alert (with derived ZIPs when geometry present) and a JSON summary.
- **npm run nws:poll** – Poll every NWS_POLL_SECONDS until SIGINT/SIGTERM.
- **npm run test** – Run unit tests (PostGIS param handling, parameterized SQL).

## How to test: all states → warnings → ZIPs

1. **Env and DB**  
   - Ensure `.env` has `DATABASE_URL` and `NWS_STATES` (see Env vars above).  
   - Apply the migration once so `alert_impacted_zips` and `zcta5_raw` exist:  
     `psql "$DATABASE_URL" -f services/nws-ingestor/migrations/001_alert_impacted_zips.sql`

2. **Run one full cycle (all states, actionable warnings only, ZIP derivation)**  
   ```bash
   npm run nws:once
   ```  
   - Fetches from NWS for every state in `NWS_STATES` (e.g. all 50).  
   - Keeps only actionable warnings (and watches if `INCLUDE_WATCH=true`).  
   - For each alert: if geometry exists, runs PostGIS intersection with ZCTA and writes ZIPs to `alert_impacted_zips`; if no geometry, writes `geom_present=false` and empty `zips`.  
   - Logs one line per alert: `event | area_desc | geom=... | zips=<count> | sent=... | expires=...`  
   - Under each alert with ZIPs: `  → 77001, 77002, ...` (up to 40 shown, then "+N more").  
   - Final line: JSON with `fetched_count`, `actionable_kept`, `geom_present_count`, `total_zips_mapped`, `impact_inserted`, `impact_updated`, `duration_ms`.

3. **Inspect in DB**  
   ```sql
   SELECT alert_id, event, geom_present, array_length(zips, 1) AS zip_count, zips
   FROM public.alert_impacted_zips
   ORDER BY created_at DESC;
   ```
