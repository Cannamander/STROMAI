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
- **LOG_LEVEL** – `info` (default), `debug`, or `trace`. Info: run header, one line per alert, run summary. Debug: adds ZIP/zones sample per alert. Trace: adds single-line JSON summary at end.
- **LOG_ZIP_SAMPLE_SIZE** – Number of ZIPs to show in debug sample (default 10)
- **LOG_ZIP_FULL** – Set `true` with debug/trace to print full ZIP list (chunked, see LOG_ZIP_FULL_MAX)
- **LOG_ZIP_FULL_MAX** – Max ZIPs to print when LOG_ZIP_FULL=true (default 200)
- **LSR_LOOKBACK_HOURS** – Hours to look back for LSR products (default 12)
- **LSR_TIME_SLOP_HOURS** – Hours before/after alert effective/expires to match LSR entry time (default 2)
- **NWS_STORE_SNAPSHOTS** – Set `false` or `0` to disable writing a row to `nws_poll_snapshots` each run (default: store). Use when running persistently for map overlay / time-window logs / alerts.
- **INFER_ZIP** – Set `false` or `0` to disable inferring ZIPs when the alert has no geometry (default: on). When on, we use **zone (UGC)** and optionally **city+state** to resolve ZIPs.
- **INFER_ZIP_GEOCODE** – Set `true` or `1` to geocode **city + state** to a point and resolve the containing ZCTA when there is no geometry and no UGC match. Uses Nominatim (no API key); respect rate limits.

## Logging

All output goes through **services/nws-ingestor/logger.js**. Layout: one **run header** block, exactly **one [ALERT] line per actionable alert**, then one **run summary** block (counters, timing, exit status). No raw payloads; ZIPs are counts only at INFO. See **LOG_EXAMPLES.md** in this directory for example INFO and DEBUG output.

## Inferring ZIPs when NWS sends no geometry

When an alert has **state, city, and/or zone (UGC)** but no polygon, we can still resolve ZIPs:

1. **Zone (UGC)** – If NWS sends `geocode.UGC` (e.g. `NJZ001`, `PAZ054`), we resolve ZIPs by:
   - Looking up **ugc_zips** (if the table is populated), or
   - **Fetching zone geometry** from `api.weather.gov/zones/forecast/{ugc}` (or `/zones/county/{ugc}` for county codes), then running the same PostGIS ZCTA intersection. Results are cached in **ugc_zips** for future runs. Run migration `004_ugc_zips.sql` so the cache table exists.
2. **City + state** – If `INFER_ZIP_GEOCODE=true` and the alert has city and state, we geocode to a point (Nominatim) and return the ZCTA containing that point. One ZIP per city; rate-limited.

The readout shows `zips=N (inferred)` when ZIPs came from UGC or geocode instead of polygon intersection.

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
- **public.nws_poll_snapshots** – One row per poll (e.g. every 15 min). Columns: `polled_at`, `duration_ms`, `fetched_count`, `actionable_count`, `geom_present_count`, `total_zips_mapped`, `impact_inserted`, `impact_updated`, LSR counts, `alert_summaries` (jsonb array of `{ id, event, headline, area_desc, expires_iso, zip_count, geom_present }`). Index on `polled_at DESC`. Lightweight time-series for map overlay, time-window logs, and alerting.

## Migrations

Run once against your Supabase Postgres (e.g. SQL Editor or `psql`):

```bash
# From repo root
psql "$DATABASE_URL" -f services/nws-ingestor/migrations/001_alert_impacted_zips.sql
psql "$DATABASE_URL" -f services/nws-ingestor/migrations/002_nws_alert_lsr.sql
psql "$DATABASE_URL" -f services/nws-ingestor/migrations/003_nws_poll_snapshots.sql
psql "$DATABASE_URL" -f services/nws-ingestor/migrations/004_ugc_zips.sql
psql "$DATABASE_URL" -f services/nws-ingestor/migrations/005_alert_impacted_states_lsr_summary.sql
psql "$DATABASE_URL" -f services/nws-ingestor/migrations/006_nws_lsr_observations.sql
psql "$DATABASE_URL" -f services/nws-ingestor/migrations/007_nws_alert_lsr_matches.sql
```
Then populate **ugc_zips** (UGC code → ZIP list) if you want ZIP inference when alerts have no geometry; see “Inferring ZIPs when NWS sends no geometry” above.

## Using poll snapshots (map overlay, time windows, alerts)

When the ingestor runs persistently (e.g. `npm run nws:poll` every 15 minutes), each run appends one row to **nws_poll_snapshots** (unless `NWS_STORE_SNAPSHOTS=false`). That gives you a time-series of what was active at each poll.

- **Map overlay** – For “current” view, use `nws_alerts` + `alert_impacted_zips` (and geometry from `nws_alerts.geometry_json`). For “what was active in the last 6 hours,” query snapshots:  
  `SELECT polled_at, alert_summaries FROM nws_poll_snapshots WHERE polled_at > now() - interval '6 hours' ORDER BY polled_at DESC;`  
  Then resolve alert IDs to geometries from `nws_alerts` or `alert_impacted_zips` for drawing.

- **Log of weather events for a time window** –  
  `SELECT polled_at, actionable_count, alert_summaries FROM nws_poll_snapshots WHERE polled_at BETWEEN $1 AND $2 ORDER BY polled_at;`  
  Each row’s `alert_summaries` is an array of compact alert info (event, headline, area_desc, expires_iso, zip_count) for that poll.

- **Alerts (e.g. “new severe event”)** – Compare latest snapshot to the previous one (e.g. new `id` in `alert_summaries`), or watch `actionable_count` / specific event types in `alert_summaries` and trigger notifications.

At 15-minute intervals you get ~96 rows/day; retention is up to you (e.g. drop rows older than 30 days with a cron or scheduled job).

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
   - **State** in the log line comes from NWS geocode (UGC/FIPS6) when present; otherwise we try to parse 2-letter codes from `area_desc`.  
   - Logs one line per alert: `[warning|watch] event | state=... | area_desc | geom=... | zips=<count> | sent=... | expires=...`  
   - Under each alert with ZIPs: `  → zips: 77001, 77002, ...` (up to 40 shown, then "+N more").  
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

## Why no geometry / no ZIPs / state=? in practice

- **Geometry**: Many NWS active alerts are issued with **county or zone names only** and do **not** include a polygon in the GeoJSON. The API returns `geometry: null` for those. Our PostGIS→ZIP logic works when geometry is present (and is tested with fake polygons in `npm run nws:test-zips`); when it’s null we correctly show `geom=false` and `zips=0 (no geometry)`.
- **State**: We derive state from NWS **geocode** (UGC or FIPS6 in `feature.properties.geocode`) when the API includes it. If the response has no geocode or a different shape, we fall back to parsing 2-letter codes from `area_desc` (e.g. "County; TX"); county-only text like "Sussex; Carbon; Monroe" has no state abbreviation, so you may see `state=?` until the API sends geocode or state in the text.
- To confirm what NWS sends for a given run, inspect `raw_json` (or the API response) for one alert; the ingestor stores the full feature in `nws_alerts.raw_json`.
