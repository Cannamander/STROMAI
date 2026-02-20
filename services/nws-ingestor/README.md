# NWS Ingestor

Polls NWS active alerts, filters to actionable warnings (and optionally watches), upserts to `nws_alerts`, derives impacted ZIPs via PostGIS (ZCTA intersection), and upserts to `alert_impacted_zips`.

## Env vars

- **DATABASE_URL** – Postgres connection string (Supabase pooler or direct). Example:  
  `postgresql://postgres.PROJECT:PASSWORD@HOST:5432/postgres?sslmode=require`
- **NWS_BASE_URL** – Default `https://api.weather.gov`
- **NWS_USER_AGENT** – Required by NWS API (identify your app)
- **NWS_POLL_SECONDS** – Poll interval when running in poll mode (default 120)
- **NWS_STATES** – Comma-separated state codes (e.g. `TX,OK,LA`). Default `TX` if unset.
- **NWS_EVENTS** – Comma-separated list of NWS event type names (exact spelling). Defaults include Hurricane Warning, Tropical Storm Warning, Storm Surge Warning, Blizzard Warning, Excessive Heat Warning, Coastal/Lakeshore Flood Warning, Dense Fog Advisory, plus the original warnings/advisories. Override in `.env` to add or drop types.
- **INCLUDE_WATCH** – Set `true` to treat “… Watch” events as actionable (default `false`)
- **DRY_RUN** – Set `true` to skip DB writes
- **LOG_LEVEL** – `info` or `debug`
- **LSR_LOOKBACK_HOURS** – Hours to look back for LSR products (default 12)
- **LSR_TIME_SLOP_HOURS** – Hours before/after alert effective/expires to match LSR entry time (default 2)

## Event types (NWS_EVENTS)

We treat only events whose **exact** name is in `NWS_EVENTS` as actionable (plus “… Watch” if `INCLUDE_WATCH=true`). Defaults are tuned for damaging / high-value weather for home services leads:

| Category | Examples in default list |
|----------|-------------------------|
| **Severe / wind** | Tornado Warning, Severe Thunderstorm Warning, High Wind Warning, Hurricane Warning, Tropical Storm Warning, Storm Surge Warning, Blizzard Warning |
| **Flood / water** | Flash Flood Warning, Coastal Flood Warning, Lakeshore Flood Warning |
| **Winter / ice** | Ice Storm Warning, Winter Storm Warning, Winter Weather Advisory |
| **Cold** | Hard Freeze Warning, Freeze Warning, Extreme Cold Warning, Wind Chill Warning, Wind Chill Advisory, Frost Advisory |
| **Heat** | Excessive Heat Warning |
| **Other** | Dense Fog Advisory |

To see what NWS actually sends, run `npm run nws:once` and check the verification line **Event types in response**. Add any exact name to `NWS_EVENTS` in `.env` to include it (e.g. `Dust Storm Warning`, `Flood Advisory`, `Heat Advisory`).

## DB tables

- **public.nws_alerts** – Raw NWS alerts (actionable-only); existing schema unchanged.
- **public.alert_impacted_zips** – One row per actionable alert with derived ZIP list from PostGIS intersection with **public.zcta5_raw** (ZCTA shapes, GIST index on `geom`). Columns: `alert_id`, `event`, `headline`, `severity`, `sent`, `effective`, `expires`, `geom_present`, `zips` (text[]), `created_at`. Unique on `alert_id`; reruns upsert.
- **public.nws_alert_lsr** – LSR (Local Storm Report) entries matched to alerts: point-in-polygon + time window. Columns: `alert_id`, `lsr_product_id`, `entry_time`, `point_geom`, `hail_in`, `wind_gust_mph`, `raw_text`, `raw_text_hash`, `created_at`. Unique on `(alert_id, lsr_product_id, entry_time, raw_text_hash)`.

## Migrations

Run once against your Supabase Postgres (e.g. SQL Editor or `psql`):

```bash
# From repo root
psql "$DATABASE_URL" -f services/nws-ingestor/migrations/001_alert_impacted_zips.sql
psql "$DATABASE_URL" -f services/nws-ingestor/migrations/002_nws_alert_lsr.sql
```

## Commands

- **npm run nws:once** – One ingest cycle then exit. Logs one line per actionable alert (with derived ZIPs when geometry present) and a JSON summary.
- **npm run nws:poll** – Poll every NWS_POLL_SECONDS until SIGINT/SIGTERM.
- **npm run test** – Run unit tests (PostGIS param handling, parameterized SQL).

## Testing (all test methods)

These are the test commands baked into the codebase. Use them to validate each part of the pipeline.

| Command | What it does | What it validates |
|--------|----------------|-------------------|
| **npm run test** | Runs Node `--test` on `db.test.js` and `lsrParser.test.js` | PostGIS ZIP query uses `$1` only; Polygon/MultiPolygon param building; LSR point-in-polygon SQL uses `$1,$2,$3`; regex parser for hail and wind lines. No DB or network. |
| **npm run nws:test-zips** | Sends fixed GeoJSON polygons (Houston, Dallas) to PostGIS, prints returned ZIPs | ZCTA intersection: `getZipsByGeometry` and `zcta5_raw` work; SRID handling. Requires `DATABASE_URL` and `zcta5_raw` populated. |
| **npm run nws:test-lsr** | Fetches recent LSR products from NWS, parses hail/wind/points, prints counts and samples; if DB has an alert with geometry, runs point-in-polygon and reports inserts | LSR API fetch; LSR parser (hail, wind, lat/lon); optional DB match + insert into `nws_alert_lsr`. Requires network; DB optional for full match step. |
| **npm run nws:once** | Full ingest: fetch alerts → filter → upsert `nws_alerts` → derive ZIPs → upsert `alert_impacted_zips` → LSR enrichment → log summary JSON | End-to-end: NWS alerts, chunked states, activation filter, ZIP derivation, LSR fetch/parse/match. Check final JSON for `lsr_products_fetched`, `lsr_entries_parsed`, `lsr_matches_inserted`, etc. |
| **DRY_RUN=true npm run nws:once** | Same as `nws:once` but skips all DB writes and LSR matching | NWS fetch + normalize + activation logic and verification log; no DB or LSR side effects. |

**Script locations**

- Unit tests: `services/nws-ingestor/db.test.js`, `services/nws-ingestor/lsrParser.test.js`
- ZIP test script: `services/nws-ingestor/scripts/test-zip-lookup.js`
- LSR test script: `services/nws-ingestor/scripts/test-lsr-enrichment.js`

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
   - LSR enrichment runs after impact: fetches recent LSR products, parses hail/wind/points, matches to alerts (point-in-polygon + time window), inserts into `nws_alert_lsr`. Failures are logged and do not block the run.
   - Final line: JSON includes `lsr_products_fetched`, `lsr_entries_parsed`, `lsr_entries_with_points`, `lsr_matches_inserted`, plus existing counts and `duration_ms`.

3. **Inspect in DB**  
   ```sql
   SELECT alert_id, event, geom_present, array_length(zips, 1) AS zip_count, zips
   FROM public.alert_impacted_zips
   ORDER BY created_at DESC;
   ```

## How to test: LSR enrichment

1. **Fetch + parse only (no DB required for first step)**  
   ```bash
   npm run nws:test-lsr
   ```  
   - Fetches recent LSR products from NWS (last `LSR_LOOKBACK_HOURS`).  
   - Parses product text for hail, wind, lat/lon.  
   - Prints: products fetched, entries parsed, entries with points, sample lines.  
   - If `nws_alerts` has at least one row with geometry, runs point-in-polygon for parsed LSR entries and reports how many matches were inserted into `nws_alert_lsr`.

2. **Full flow**  
   Run `npm run nws:once` when there are actionable alerts. The final JSON line includes `lsr_products_fetched`, `lsr_entries_parsed`, `lsr_entries_with_points`, `lsr_matches_inserted`. Non-zero `lsr_matches_inserted` means at least one LSR report fell inside an alert’s geometry and time window.

3. **Inspect LSR matches in DB**  
   ```sql
   SELECT alert_id, lsr_product_id, entry_time, hail_in, wind_gust_mph, LEFT(raw_text, 80) AS raw_preview
   FROM public.nws_alert_lsr
   ORDER BY created_at DESC
   LIMIT 20;
   ```
