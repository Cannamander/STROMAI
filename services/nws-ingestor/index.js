require('dotenv').config();
const config = require('./config');
const { fetchActiveAlerts } = require('./nwsClient');
const { normalizeFeature } = require('./normalize');
const { classifyAlert, isActionable } = require('./activation');
const { upsertAlerts, closePool } = require('./db');

// DB insert is actionable-only: warnings (allowlist) + optionally watches when INCLUDE_WATCH=true.
// Expires must be in the future. All filtering is via classifyAlert + future-expires.

function formatExpires(expires) {
  if (expires == null) return '';
  return expires instanceof Date ? expires.toISOString() : String(expires);
}

/**
 * Run one ingest cycle: fetch, normalize, classify, upsert actionable-only.
 * @returns {Promise<{ fetched_count, normalized_count, actionable_count, inserted_count, updated_count, duration_ms }>}
 */
async function ingestOnce() {
  const start = Date.now();
  let fetched_count = 0;
  let normalized_count = 0;
  let actionable_count = 0;
  let inserted_count = 0;
  let updated_count = 0;

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

    if (config.dryRun) {
      const duration_ms = Date.now() - start;
      const summary = {
        fetched_count,
        normalized_count,
        actionable_count,
        inserted_count: 0,
        updated_count: 0,
        duration_ms,
        dry_run: true,
      };
      console.log(JSON.stringify(summary));
      logTopActionable(actionableRows, 5);
      return { ...summary };
    }

    const result = await upsertAlerts(actionableRows);
    inserted_count = result.inserted_count;
    updated_count = result.updated_count;

    const duration_ms = Date.now() - start;
    const summary = {
      fetched_count,
      normalized_count,
      actionable_count,
      inserted_count,
      updated_count,
      duration_ms,
    };
    console.log(JSON.stringify(summary));
    logTopActionable(actionableRows, 5);
    return summary;
  } catch (err) {
    const duration_ms = Date.now() - start;
    console.error(JSON.stringify({
      error: err.message,
      fetched_count,
      normalized_count,
      actionable_count,
      inserted_count,
      updated_count,
      duration_ms,
    }));
    throw err;
  }
}

/** Log up to `max` actionable alerts: [warning|watch] event | expires | area_desc | geometry_present | id */
function logTopActionable(rows, max) {
  const top = (rows || []).slice(0, max);
  for (const row of top) {
    const { kind } = classifyAlert(row);
    const line = [
      `[${kind}]`,
      row.event ?? '',
      '|',
      formatExpires(row.expires),
      '|',
      row.area_desc ?? '',
      '|',
      'geometry_present=' + (row.geometry_json != null),
      '|',
      row.id ?? '',
    ].join(' ');
    console.log(line);
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
