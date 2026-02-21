require('dotenv').config();
const config = require('./config');
const { fetchActiveAlerts } = require('./nwsClient');
const { normalizeFeature } = require('./normalize');
const { classifyAlert, isActionable } = require('./activation');
const { upsertAlerts, getAreaSqMiles, getZipsByGeometry, getZipsByPoint, getZipsByUgc, insertUgcZips, upsertAlertImpactedZips, insertPollSnapshot, getAlertLsrSummaries, updateAlertThresholdsAndScore, closePool } = require('./db');
const { deriveAlertClass, deriveGeoMethod, deriveZipInferenceMethod, computeZipDensity } = require('./alertClass');
const { FREEZE_EVENT_NAMES } = require('./thresholds');
const { runLsrPipeline } = require('./lsrEnrich');
const { fetchZoneGeometry } = require('./zoneClient');
const log = require('./logger');

// Ingest ALL alerts with future expires; compute and persist impacted_states and impacted_zips for every alert.
// Only WARNINGS get LSR enrichment (set-based match in DB). Watches and advisories are still ingested and logged.

const STATE_CODES = new Set(['AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY','DC','PR','VI','GU','AS','MP']);

function formatIso(expires) {
  if (expires == null) return '';
  return expires instanceof Date ? expires.toISOString() : String(expires);
}

/** Extract 2-letter state codes mentioned in area_desc (e.g. "County; TX" or "TX, OK"). */
function statesFromAreaDesc(areaDesc) {
  if (!areaDesc || typeof areaDesc !== 'string') return [];
  const found = new Set();
  const re = /\b([A-Z]{2})\b/g;
  let m;
  while ((m = re.exec(areaDesc.toUpperCase())) !== null) {
    if (STATE_CODES.has(m[1])) found.add(m[1]);
  }
  return [...found].sort();
}

/** Parse UGC list from location.zone string (comma-separated). */
function parseUgcs(zoneStr) {
  if (!zoneStr || typeof zoneStr !== 'string') return [];
  return zoneStr.split(',').map((s) => s.trim().toUpperCase()).filter((s) => s.length >= 5);
}

/** Derive state codes only from UGC zone list (first 2 chars of each). Use for state lines so we don't mix in FIPS/SAME from other contexts (e.g. AZ appearing for a NJ/PA alert). */
function statesFromUgcs(ugcCodes) {
  if (!Array.isArray(ugcCodes) || ugcCodes.length === 0) return [];
  const set = new Set();
  for (const code of ugcCodes) {
    const s = String(code).trim().toUpperCase().slice(0, 2);
    if (s.length === 2 && STATE_CODES.has(s)) set.add(s);
  }
  return [...set].sort();
}

/** True if alert is a "warning" for LSR enrichment: event ends with "Warning" or severity Severe/Extreme. */
function isWarning(row) {
  const event = (row && row.event) ? String(row.event) : '';
  if (event.endsWith(' Warning')) return true;
  const sev = (row && row.severity) ? String(row.severity) : '';
  if (['Severe', 'Extreme'].includes(sev)) return true;
  return false;
}

/** Geocode "City, ST" to { lon, lat } via Nominatim (no API key). Rate-limited. Returns null on failure. */
async function geocodeCityState(city, state) {
  if (!city || !state || !config.inferZipGeocode) return null;
  const q = encodeURIComponent(`${String(city).trim()}, ${String(state).trim()}, USA`);
  try {
    const { fetch } = require('undici');
    const res = await fetch(
      `https://nominatim.openstreetmap.org/search?q=${q}&format=json&limit=1`,
      { headers: { 'User-Agent': config.nwsUserAgent } }
    );
    if (!res.ok) return null;
    const data = await res.json();
    const first = Array.isArray(data) && data[0];
    if (first && first.lat != null && first.lon != null) {
      return { lat: parseFloat(first.lat), lon: parseFloat(first.lon) };
    }
  } catch (_) {
    // ignore
  }
  return null;
}

/**
 * Run one ingest cycle: fetch, normalize, classify, upsert actionable-only, then derive ZIPs and upsert alert_impacted_zips.
 * @param {{ mode?: string }} opts - mode 'once' or 'poll' for run header
 * @returns {Promise<{ fetched_count, normalized_count, actionable_count, inserted_count, updated_count, geom_present_count, total_zips_mapped, impact_inserted, impact_updated, duration_ms }>}
 */
async function ingestOnce(opts = {}) {
  const mode = opts.mode === 'poll' ? 'poll' : 'once';
  const start = Date.now();
  let fetched_count = 0;
  let normalized_count = 0;
  let actionable_count = 0;
  let inserted_count = 0;
  let updated_count = 0;
  let geom_present_count = 0;
  let total_zips_mapped = 0;
  let impact_inserted = 0;
  let impact_updated = 0;
  let lsr_products_fetched = 0;
  let lsr_entries_parsed = 0;
  let lsr_entries_with_points = 0;
  let lsr_matches_inserted = 0;
  let errorsCount = 0;
  const rateLimitRetries = 0;

  const timings = { fetch_nws_ms: 0, upsert_alerts_ms: 0, zips_ms: 0, impact_ms: 0, lsr_ms: 0 };
  let upsertResultById = {};

  try {
    let t0 = Date.now();
    const data = await fetchActiveAlerts();
    timings.fetch_nws_ms = Date.now() - t0;
    const features = Array.isArray(data.features) ? data.features : [];
    fetched_count = features.length;

    const normalized = features.map(normalizeFeature).filter(Boolean);
    normalized_count = normalized.length;

    const now = new Date();
    const withFutureExpires = normalized.filter(
      (row) => row.expires == null || (row.expires instanceof Date ? row.expires > now : new Date(row.expires) > now)
    );
    actionable_count = withFutureExpires.length;

    const eventCounts = {};
    for (const row of normalized) {
      const e = row.event || '(no event)';
      eventCounts[e] = (eventCounts[e] || 0) + 1;
    }

    log.runHeader({
      mode,
      area: config.nwsStates,
      fetched: fetched_count,
      eventCounts,
      allowlistCount: (config.allowedEvents || []).length,
      includeWatch: config.includeWatch,
      actionableKept: actionable_count,
    });

    if (config.dryRun) {
      timings.total_ms = Date.now() - start;
      log.runSummary(
        {
          fetched_count,
          actionable_kept: actionable_count,
          geom_present_count: 0,
          total_zips_mapped: 0,
          nws_alerts_inserted: 0,
          nws_alerts_updated: 0,
          impact_inserted: 0,
          impact_updated: 0,
          lsr_products_fetched: 0,
          lsr_entries_parsed: 0,
          lsr_entries_with_points: 0,
          lsr_matches_inserted: 0,
        },
        { ...timings, total_ms: timings.total_ms },
        true,
        errorsCount,
        rateLimitRetries
      );
      log.traceJsonSummary({ fetched_count, actionable_kept: actionable_count, duration_ms: timings.total_ms, dry_run: true });
      return { fetched_count, normalized_count, actionable_count, inserted_count: 0, updated_count: 0, geom_present_count: 0, total_zips_mapped: 0, impact_inserted: 0, impact_updated: 0, duration_ms: timings.total_ms };
    }

    t0 = Date.now();
    const result = await upsertAlerts(withFutureExpires);
    timings.upsert_alerts_ms = Date.now() - t0;
    inserted_count = result.inserted_count;
    updated_count = result.updated_count;
    upsertResultById = result.resultById || {};

    // Build impact rows for ALL alerts: impacted_states from UGC; ZIPs from PostGIS when geom present, else infer or leave empty
    t0 = Date.now();
    const impactRows = await Promise.all(
      withFutureExpires.map(async (row) => {
        const geom_present = row.geometry_json != null;
        let zips = [];
        const loc = row.location || {};
        const ugcs = parseUgcs(loc.zone || '');
        const impacted_states = statesFromUgcs(ugcs);
        if (geom_present) {
          zips = await getZipsByGeometry(row.geometry_json);
        } else if (config.inferZip && loc.zone && ugcs.length > 0) {
          const combined = new Set();
          for (const ugc of ugcs) {
            let z = await getZipsByUgc([ugc]);
            if (z.length === 0) {
              const geom = await fetchZoneGeometry(ugc);
              if (geom) {
                z = await getZipsByGeometry(geom);
                if (z.length > 0) await insertUgcZips(ugc, z);
              }
              if (config.inferZipDelayMs > 0) await new Promise((r) => setTimeout(r, config.inferZipDelayMs));
            }
            z.forEach((zip) => combined.add(zip));
          }
          zips = [...combined];
        }
        if (zips.length === 0 && !geom_present && loc.city && loc.state && config.inferZipGeocode) {
          const pt = await geocodeCityState(loc.city, loc.state);
          if (pt) zips = await getZipsByPoint(pt.lon, pt.lat);
        }
        const zip_count = zips.length;
        let area_sq_miles = null;
        if (geom_present && row.geometry_json) {
          area_sq_miles = await getAreaSqMiles(row.geometry_json);
        }
        const alert_class = deriveAlertClass(row.event);
        const geo_method = deriveGeoMethod(geom_present, ugcs);
        const zip_inference_method = deriveZipInferenceMethod(geom_present, zip_count);
        const zip_density = computeZipDensity(zip_count, area_sq_miles);
        return {
          id: row.id,
          event: row.event,
          headline: row.headline,
          severity: row.severity,
          sent: row.sent,
          effective: row.effective,
          expires: row.expires,
          geom_present,
          zips,
          impacted_states: impacted_states.length ? impacted_states : [],
          alert_class,
          area_sq_miles,
          zip_density,
          geo_method,
          zip_inference_method,
        };
      })
    );
    geom_present_count = impactRows.filter((r) => r.geom_present).length;
    total_zips_mapped = impactRows.reduce((sum, r) => sum + (r.zips?.length ?? 0), 0);
    timings.zips_ms = Date.now() - t0;

    t0 = Date.now();
    const impactResult = await upsertAlertImpactedZips(impactRows);
    timings.impact_ms = Date.now() - t0;
    impact_inserted = impactResult.inserted_count;
    impact_updated = impactResult.updated_count;

    // Log [ALERT] lines immediately (use current DB LSR state); run LSR pipeline after so output appears faster
    const alertIds = impactRows.map((r) => r.id);
    let lsrByAlertId = {};
    try {
      const summaries = await getAlertLsrSummaries(alertIds);
      for (const s of summaries) lsrByAlertId[s.alert_id] = s;
    } catch (_) {}

    for (const row of impactRows) {
      const alertRow = withFutureExpires.find((r) => r.id === row.id);
      const statesList = (row.impacted_states && row.impacted_states.length) ? row.impacted_states : (alertRow?.area_desc ? statesFromAreaDesc(alertRow.area_desc) : []);
      const statesCsv = statesList.length ? statesList.join(',') : '—';
      const upsert = upsertResultById[row.id] === 'insert' ? 'inserted' : upsertResultById[row.id] === 'update' ? 'updated' : 'skipped';
      const lsrSummary = lsrByAlertId[row.id];
      const lsrCount = lsrSummary && lsrSummary.lsr_match_count != null ? lsrSummary.lsr_match_count : 'N/A';

      log.alertLine({
        event: row.event,
        severity: row.severity,
        sent: row.sent,
        exp: row.expires,
        states: statesCsv,
        geom: row.geom_present,
        zipsCount: (row.zips || []).length,
        lsr: lsrCount,
        upsert,
      });
      if (isWarning(alertRow || row) && lsrSummary && (lsrSummary.lsr_match_count || 0) > 0 && log.isDebug()) {
        log.lsrSummaryLine({
          count: lsrSummary.lsr_match_count,
          hail_max: lsrSummary.hail_max_inches ?? '—',
          wind_max: lsrSummary.wind_max_mph ?? '—',
          tornado: lsrSummary.tornado_count ?? 0,
          flood: lsrSummary.flood_count ?? 0,
          damage_hits: lsrSummary.damage_keyword_hits ?? 0,
          notable: lsrSummary.lsr_top_tokens || [],
        });
      }
      if (log.isDebug()) {
        log.alertDetailsDebug({ zips: row.zips || [], zones: parseUgcs(alertRow?.location?.zone || '') });
      }
    }

    try {
      t0 = Date.now();
      const lsrResult = await runLsrPipeline();
      timings.lsr_ms = Date.now() - t0;
      lsr_products_fetched = lsrResult.lsr_products_fetched;
      lsr_entries_parsed = lsrResult.lsr_observations_parsed;
      lsr_entries_with_points = lsrResult.lsr_observations_upserted;
      lsr_matches_inserted = lsrResult.lsr_matches_inserted;
    } catch (lsrErr) {
      errorsCount++;
      log.errorMsg('LSR pipeline failed: ' + (lsrErr && lsrErr.message));
    }

    try {
      await updateAlertThresholdsAndScore(
        config.interestingHailInches,
        config.interestingWindMph,
        config.freezeRareStates,
        FREEZE_EVENT_NAMES
      );
    } catch (thrErr) {
      errorsCount++;
      log.errorMsg('Thresholds/score update failed: ' + (thrErr && thrErr.message));
    }

    const duration_ms = Date.now() - start;
    timings.total_ms = duration_ms;

    const counters = {
      fetched_count,
      actionable_kept: actionable_count,
      geom_present_count,
      total_zips_mapped,
      nws_alerts_inserted: inserted_count,
      nws_alerts_updated: updated_count,
      impact_inserted,
      impact_updated,
      lsr_products_fetched,
      lsr_entries_parsed,
      lsr_entries_with_points,
      lsr_matches_inserted,
    };
    log.runSummary(counters, timings, true, errorsCount, rateLimitRetries);

    const summary = {
      ...counters,
      duration_ms,
    };
    const alertSummaries = impactRows.map((row) => ({
      id: row.id,
      event: row.event ?? null,
      headline: (withFutureExpires.find((r) => r.id === row.id)?.headline) ?? null,
      area_desc: (withFutureExpires.find((r) => r.id === row.id)?.area_desc ?? '').replace(/\n/g, ' ').slice(0, 500),
      expires_iso: formatIso(row.expires),
      zip_count: (row.zips || []).length,
      geom_present: row.geom_present,
    }));
    if (config.storeSnapshots) {
      try {
        await insertPollSnapshot(summary, alertSummaries);
      } catch (snapErr) {
        errorsCount++;
        log.errorMsg('snapshot insert failed: ' + (snapErr && snapErr.message));
      }
    }
    log.traceJsonSummary(summary);

    return {
      fetched_count,
      normalized_count,
      actionable_count,
      inserted_count,
      updated_count,
      geom_present_count,
      total_zips_mapped,
      impact_inserted,
      impact_updated,
      lsr_products_fetched,
      lsr_entries_parsed,
      lsr_entries_with_points,
      lsr_matches_inserted,
      duration_ms,
    };
  } catch (err) {
    errorsCount++;
    const duration_ms = Date.now() - start;
    timings.total_ms = duration_ms;
    log.runSummary(
      {
        fetched_count,
        actionable_kept: actionable_count,
        geom_present_count,
        total_zips_mapped,
        nws_alerts_inserted: inserted_count,
        nws_alerts_updated: updated_count,
        impact_inserted,
        impact_updated,
        lsr_products_fetched,
        lsr_entries_parsed,
        lsr_entries_with_points,
        lsr_matches_inserted,
      },
      timings,
      false,
      errorsCount,
      rateLimitRetries
    );
    log.errorMsg('ingest failed: ' + (err && err.message));
    log.traceJsonSummary({ error: err && err.message, fetched_count, actionable_kept: actionable_count, duration_ms });
    throw err;
  }
}

/**
 * Poll NWS every config.nwsPollSeconds (default 120). Runs until process exit.
 */
function startPolling() {
  const intervalMs = config.nwsPollSeconds * 1000;
  log.pollStarted(config.nwsPollSeconds);

  function run() {
    ingestOnce({ mode: 'poll' }).catch((err) => {
      log.errorMsg('Ingest cycle error: ' + (err && err.message));
    });
  }

  run();
  const timer = setInterval(run, intervalMs);

  const shutdown = () => {
    clearInterval(timer);
    closePool().then(() => process.exit(0)).catch(() => process.exit(1));
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

module.exports = { ingestOnce, startPolling };

// CLI: node index.js [once|poll] (only when run directly, not when required by API)
if (require.main === module) {
  const cliMode = process.argv[2] || 'once';
  if (cliMode === 'poll') {
    startPolling();
  } else {
    ingestOnce({ mode: 'once' })
      .then(() => closePool())
      .then(() => process.exit(0))
      .catch((err) => {
        log.fatal(err && err.message);
        closePool().finally(() => process.exit(1));
      });
  }
}
