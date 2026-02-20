require('dotenv').config();
const config = require('./config');
const { fetchActiveAlerts } = require('./nwsClient');
const { normalizeFeature } = require('./normalize');
const { classifyAlert, isActionable } = require('./activation');
const { upsertAlerts, getZipsByGeometry, upsertAlertImpactedZips, closePool } = require('./db');
const { enrichWithLsr } = require('./lsrEnrich');

// DB insert is actionable-only: warnings (allowlist) + optionally watches when INCLUDE_WATCH=true.
// Expires must be in the future. All filtering is via classifyAlert + future-expires.

function formatIso(expires) {
  if (expires == null) return '';
  return expires instanceof Date ? expires.toISOString() : String(expires);
}

/**
 * Run one ingest cycle: fetch, normalize, classify, upsert actionable-only, then derive ZIPs and upsert alert_impacted_zips.
 * @returns {Promise<{ fetched_count, normalized_count, actionable_count, inserted_count, updated_count, geom_present_count, total_zips_mapped, impact_inserted, impact_updated, duration_ms }>}
 */
async function ingestOnce() {
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

  try {
    const data = await fetchActiveAlerts();
    const features = Array.isArray(data.features) ? data.features : [];
    fetched_count = features.length;

    const normalized = features.map(normalizeFeature).filter(Boolean);
    normalized_count = normalized.length;

    const now = new Date();
    const withFutureExpires = normalized.filter(
      (row) => row.expires == null || (row.expires instanceof Date ? row.expires > now : new Date(row.expires) > now)
    );
    const actionableRows = withFutureExpires.filter((row) => isActionable(row));
    actionable_count = actionableRows.length;

    // Verification: so you can be sure we hit NWS and why actionable is 0 or N
    const eventCounts = {};
    for (const row of normalized) {
      const e = row.event || '(no event)';
      eventCounts[e] = (eventCounts[e] || 0) + 1;
    }
    console.error(
      'Verification: fetched',
      fetched_count,
      'features from NWS (states:',
      config.nwsStates.length,
      '). Event types in response:',
      JSON.stringify(eventCounts)
    );
    console.error(
      'Actionable = NWS_EVENTS (' + (config.allowedEvents || []).length + ' types)',
      config.includeWatch ? '+ events ending in "Watch"' : '',
      '| actionable_kept =',
      actionable_count
    );

    if (config.dryRun) {
      const duration_ms = Date.now() - start;
      const summary = {
        fetched_count,
        normalized_count,
        actionable_count,
        inserted_count: 0,
        updated_count: 0,
        geom_present_count: 0,
        total_zips_mapped: 0,
        impact_inserted: 0,
        impact_updated: 0,
        duration_ms,
        dry_run: true,
      };
      console.log(JSON.stringify(summary));
      return { ...summary };
    }

    const result = await upsertAlerts(actionableRows);
    inserted_count = result.inserted_count;
    updated_count = result.updated_count;

    // Build impact rows: derive ZIPs via PostGIS when geometry present, else geom_present=false and zips=[]
    const impactRows = [];
    for (const row of actionableRows) {
      const geom_present = row.geometry_json != null;
      if (geom_present) geom_present_count++;
      let zips = [];
      if (geom_present) {
        zips = await getZipsByGeometry(row.geometry_json);
        total_zips_mapped += zips.length;
      }
      impactRows.push({
        id: row.id,
        event: row.event,
        headline: row.headline,
        severity: row.severity,
        sent: row.sent,
        effective: row.effective,
        expires: row.expires,
        geom_present,
        zips,
      });
    }

    const impactResult = await upsertAlertImpactedZips(impactRows);
    impact_inserted = impactResult.inserted_count;
    impact_updated = impactResult.updated_count;

    try {
      const lsrResult = await enrichWithLsr(actionableRows);
      lsr_products_fetched = lsrResult.lsr_products_fetched;
      lsr_entries_parsed = lsrResult.lsr_entries_parsed;
      lsr_entries_with_points = lsrResult.lsr_entries_with_points;
      lsr_matches_inserted = lsrResult.lsr_matches_inserted;
    } catch (lsrErr) {
      console.error('[LSR] enrich failed:', lsrErr.message);
    }

    const duration_ms = Date.now() - start;

    // One summary line per actionable alert: [warning] or [watch] then event | area | geom | zips | sent | expires
    for (const row of impactRows) {
      const actionableRow = actionableRows.find((r) => r.id === row.id);
      const kind = actionableRow ? classifyAlert(actionableRow).kind : 'other';
      const line = [
        `[${kind}]`,
        row.event ?? '',
        '|',
        (actionableRow?.area_desc ?? '').replace(/\n/g, ' '),
        '|',
        'geom=' + row.geom_present,
        '|',
        'zips=' + (row.zips?.length ?? 0),
        '|',
        'sent=' + formatIso(row.sent),
        '|',
        'expires=' + formatIso(row.expires),
      ].join(' ');
      console.log(line);
      if (row.zips && row.zips.length > 0) {
        const maxShow = 40;
        const shown = row.zips.slice(0, maxShow).join(', ');
        const more = row.zips.length > maxShow ? ` ... +${row.zips.length - maxShow} more` : '';
        console.log('  → ' + shown + more);
      }
    }

    const summary = {
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
      duration_ms,
    };
    console.log(JSON.stringify(summary));
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
    const duration_ms = Date.now() - start;
    console.error(JSON.stringify({
      error: err.message,
      fetched_count,
      normalized_count,
      actionable_count,
      duration_ms,
    }));
    throw err;
  }
}

/**
 * Poll NWS every config.nwsPollSeconds (default 120). Runs until process exit.
 */
function startPolling() {
  const intervalMs = config.nwsPollSeconds * 1000;
  console.log(JSON.stringify({ msg: 'NWS ingestor polling started', interval_seconds: config.nwsPollSeconds }));

  function run() {
    ingestOnce().catch((err) => {
      console.error('Ingest cycle error:', err.message);
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

// CLI: node index.js [once|poll]
const mode = process.argv[2] || 'once';
if (mode === 'poll') {
  startPolling();
} else {
  ingestOnce()
    .then(() => closePool())
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err);
      closePool().finally(() => process.exit(1));
    });
}

module.exports = { ingestOnce, startPolling };
