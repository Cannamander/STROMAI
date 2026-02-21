'use strict';
const config = require('./config');

const LEVELS = { trace: 3, debug: 2, info: 1 };
const level = LEVELS[config.logLevel] || 1;

const LOG_ZIP_SAMPLE_SIZE = Math.max(0, parseInt(process.env.LOG_ZIP_SAMPLE_SIZE, 10) || 10);
const LOG_ZIP_FULL = process.env.LOG_ZIP_FULL === 'true' || process.env.LOG_ZIP_FULL === '1';
const LOG_ZIP_FULL_MAX = Math.max(1, parseInt(process.env.LOG_ZIP_FULL_MAX, 10) || 200);

function isDebug() {
  return level >= LEVELS.debug;
}
function isTrace() {
  return level >= LEVELS.trace;
}

/** Never print undefined; use empty string or placeholder. */
function safe(val) {
  if (val === undefined || val === null) return '';
  return String(val).trim();
}

/** Format ISO for display; never undefined. */
function iso(val) {
  if (val == null) return '';
  if (val instanceof Date) return val.toISOString();
  return String(val);
}

/** Event type counts sorted desc, then by name. Return array of [name, count]. */
function sortedEventCounts(eventCounts) {
  if (!eventCounts || typeof eventCounts !== 'object') return [];
  return Object.entries(eventCounts)
    .map(([name, cnt]) => [safe(name) || '(no event)', Number(cnt) || 0])
    .sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])));
}

/**
 * Run header block (multi-line). Printed once per run.
 * @param {object} opts - mode, area (state codes array or string), fetched, eventCounts (object), allowlistCount, includeWatch, actionableKept
 */
function runHeader(opts) {
  const mode = safe(opts.mode) || 'once';
  const area = Array.isArray(opts.area) ? opts.area.join(',') : safe(opts.area);
  const fetched = opts.fetched != null ? Number(opts.fetched) : 0;
  const eventCounts = sortedEventCounts(opts.eventCounts || {});
  const allowlistCount = opts.allowlistCount != null ? Number(opts.allowlistCount) : 0;
  const includeWatch = opts.includeWatch === true || opts.includeWatch === '1';
  const actionableKept = opts.actionableKept != null ? Number(opts.actionableKept) : 0;

  const lines = [
    'AI-STORMS NWS INGEST RUN',
    '  Mode:       ' + mode,
    '  Area:       ' + (area || '—'),
    '  Fetched:    ' + fetched + ' features',
    '  Event types: ' + (eventCounts.length ? eventCounts.map(([n, c]) => `${n}=${c}`).join(', ') : '—'),
    '  Ingested:   ' + actionableKept + ' alert(s) with future expires (all event types). [ALERT] lines below, one per alert.',
  ];
  lines.forEach((line) => console.log(line));
}

/**
 * One alert line (single line). Parsable format.
 * @param {object} opts - event, severity, sent, exp, states (csv string), geom (Y/N), zipsCount, lsr (number or 'N/A'), upsert optional
 */
function alertLine(opts) {
  const event = safe(opts.event) || '—';
  const sev = safe(opts.severity) || '—';
  const sent = iso(opts.sent);
  const exp = iso(opts.exp);
  const states = safe(opts.states) || '—';
  const geom = opts.geom === true || opts.geom === 'Y' ? 'Y' : 'N';
  const zipsCount = opts.zipsCount != null ? Number(opts.zipsCount) : 0;
  const lsr = opts.lsr != null && opts.lsr !== 'N/A' && !Number.isNaN(Number(opts.lsr))
    ? String(Number(opts.lsr)) : 'N/A';
  const upsert = ['inserted', 'updated', 'skipped'].includes(safe(opts.upsert)) ? opts.upsert : '';

  const parts = [
    '[ALERT]',
    event,
    '|',
    'sev=' + sev,
    '|',
    'sent=' + sent,
    '|',
    'exp=' + exp,
    '|',
    'states=' + states,
    '|',
    'zips=' + zipsCount,
    '|',
    'geom=' + geom,
    '|',
    'lsr=' + lsr,
  ];
  if (upsert) parts.push('|', 'upsert=' + upsert);
  const zipInference = safe(opts.zip_inference);
  if (zipInference && geom === 'N') parts.push('|', 'zip_inference=' + zipInference);
  console.log(parts.join(' '));
}

/**
 * Debug-only: one [GEO] diagnostic line per alert (first N per run). Confirms geometry presence and zone counts.
 * Never prints raw payloads.
 * @param {object} opts - event, geom (boolean Y/N), ugc (count), affectedZones (count), areaDesc (string, first 60 chars used)
 */
function geoLine(opts) {
  if (!isDebug()) return;
  const event = safe(opts.event) || '—';
  const geom = opts.geom === true || opts.geom === 'Y' ? 'Y' : 'N';
  const ugc = opts.ugc != null ? Number(opts.ugc) : 0;
  const affectedZones = opts.affectedZones != null ? Number(opts.affectedZones) : 0;
  const areaDesc = safe(opts.areaDesc) ? String(opts.areaDesc).slice(0, 60) : '—';
  console.log('[GEO] event=' + event + ' geom=' + geom + ' ugc=' + ugc + ' affectedZones=' + affectedZones + ' areaDesc=' + areaDesc);
}

/**
 * Debug-only LSR summary for a warning (one line).
 * @param {object} opts - count, hail_max, wind_max, tornado, flood, damage_hits, notable (short string or array of tokens)
 */
function lsrSummaryLine(opts) {
  if (!isDebug()) return;
  const count = opts.count != null ? Number(opts.count) : 0;
  const hail_max = opts.hail_max != null ? opts.hail_max : '—';
  const wind_max = opts.wind_max != null ? opts.wind_max : '—';
  const tornado = opts.tornado != null ? Number(opts.tornado) : 0;
  const flood = opts.flood != null ? Number(opts.flood) : 0;
  const damage_hits = opts.damage_hits != null ? Number(opts.damage_hits) : 0;
  const notable = Array.isArray(opts.notable) ? opts.notable.slice(0, 3).join('; ') : (safe(opts.notable) || '—');
  console.log(
    '  lsr_summary: count=' + count +
    ' hail_max=' + hail_max +
    ' wind_max=' + wind_max +
    ' tornado=' + tornado +
    ' flood=' + flood +
    ' damage_hits=' + damage_hits +
    ' notable=' + (notable.length > 80 ? notable.slice(0, 80) + '...' : notable)
  );
}

/**
 * One line per state: state, event, location details, and ZIP list (sample on line; full when LOG_ZIP_FULL+debug).
 * Use for run once and poll so each state that has an event gets a line with location + event type + zips.
 * @param {object} opts - state, event, area, county, city, zones (array or csv), geom, zips (array), upsert
 */
function alertStateLine(opts) {
  const state = safe(opts.state) || '—';
  const event = safe(opts.event) || '—';
  const area = safe(opts.area) || '—';
  const county = safe(opts.county) || '—';
  const city = safe(opts.city) || '—';
  const zonesArr = Array.isArray(opts.zones) ? opts.zones : (opts.zones ? String(opts.zones).split(',').map((s) => s.trim()).filter(Boolean) : []);
  const zonesStr = zonesArr.length > 0 ? zonesArr.join(',') : '—';
  const geom = opts.geom === true || opts.geom === 'Y' ? 'Y' : 'N';
  const zips = Array.isArray(opts.zips) ? opts.zips : [];
  const zipsCount = zips.length;
  const sampleSize = Math.min(LOG_ZIP_SAMPLE_SIZE, zips.length);
  const zipSampleStr = zips.length > 0
    ? zips.slice(0, sampleSize).join(',') + (zips.length > sampleSize ? ' (' + zips.length + ' total)' : '')
    : '—';
  const upsert = ['inserted', 'updated', 'skipped'].includes(safe(opts.upsert)) ? opts.upsert : 'skipped';

  const line = [
    '[STATE]',
    'state=' + state,
    '|',
    'event=' + event,
    '|',
    'area=' + (area.length > 60 ? area.slice(0, 60) + '...' : area),
    '|',
    'county=' + county,
    '|',
    'city=' + city,
    '|',
    'zones=' + zonesStr,
    '|',
    'geom=' + geom,
    '|',
    'zips=' + zipsCount,
    '|',
    zipSampleStr,
    '|',
    'upsert=' + upsert,
  ].join(' ');
  console.log(line);
  if (LOG_ZIP_FULL && (isDebug() || isTrace()) && zips.length > 0) {
    const maxShow = Math.min(LOG_ZIP_FULL_MAX, zips.length);
    const chunk = 20;
    for (let i = 0; i < maxShow; i += chunk) {
      const slice = zips.slice(i, i + chunk).join(', ');
      console.log('  zips: ' + slice + (i + chunk < maxShow ? '' : maxShow < zips.length ? ' ... +' + (zips.length - maxShow) + ' more' : ''));
    }
  }
}

/**
 * Optional debug details after an alert: zips_sample (and optionally zones_sample, full ZIP list).
 * Only called when LOG_LEVEL=debug (or trace). LOG_ZIP_FULL and LOG_ZIP_FULL_MAX apply for full list.
 */
function alertDetailsDebug(opts) {
  if (!isDebug()) return;
  const zips = Array.isArray(opts.zips) ? opts.zips : [];
  const zones = Array.isArray(opts.zones) ? opts.zones : [];
  const sampleSize = Math.min(LOG_ZIP_SAMPLE_SIZE, zips.length);

  if (zips.length > 0) {
    const sample = zips.slice(0, sampleSize).join(', ');
    console.log('  zips_sample: ' + sample + (zips.length > sampleSize ? ' (' + sampleSize + ' of ' + zips.length + ')' : ''));
  }
  if (zones.length > 0) {
    const zoneSample = zones.slice(0, Math.min(LOG_ZIP_SAMPLE_SIZE, zones.length)).join(', ');
    console.log('  zones_sample: ' + zoneSample + (zones.length > LOG_ZIP_SAMPLE_SIZE ? ' (' + zones.length + ' total)' : ''));
  }
  if (LOG_ZIP_FULL && (isDebug() || isTrace()) && zips.length > 0) {
    const maxShow = Math.min(LOG_ZIP_FULL_MAX, zips.length);
    const chunk = 20;
    for (let i = 0; i < maxShow; i += chunk) {
      const slice = zips.slice(i, i + chunk).join(', ');
      console.log('  zips_full:   ' + slice + (i + chunk < maxShow ? '' : maxShow < zips.length ? ' ... (+' + (zips.length - maxShow) + ' more)' : ''));
    }
  }
}

/**
 * Run summary block (multi-line). Counters, timings, exit status.
 * @param {object} counters - all numeric counters
 * @param {object} timings - stage names to ms
 * @param {boolean} success
 * @param {number} errorsCount
 * @param {number} rateLimitRetries
 */
function runSummary(counters, timings, success, errorsCount, rateLimitRetries) {
  const pad = 28;
  const lines = [
    '—',
    'RUN SUMMARY',
    '  Counters:',
    '    fetched_count:            ' + (counters.fetched_count != null ? counters.fetched_count : ''),
    '    actionable_kept:          ' + (counters.actionable_kept != null ? counters.actionable_kept : ''),
    '    geom_present_count:       ' + (counters.geom_present_count != null ? counters.geom_present_count : ''),
    '    total_zips_mapped:        ' + (counters.total_zips_mapped != null ? counters.total_zips_mapped : ''),
    '    nws_alerts_inserted:      ' + (counters.nws_alerts_inserted != null ? counters.nws_alerts_inserted : ''),
    '    nws_alerts_updated:       ' + (counters.nws_alerts_updated != null ? counters.nws_alerts_updated : ''),
    '    impact_inserted:          ' + (counters.impact_inserted != null ? counters.impact_inserted : ''),
    '    impact_updated:           ' + (counters.impact_updated != null ? counters.impact_updated : ''),
    '    lsr_products_fetched:     ' + (counters.lsr_products_fetched != null ? counters.lsr_products_fetched : ''),
    '    lsr_entries_parsed:       ' + (counters.lsr_entries_parsed != null ? counters.lsr_entries_parsed : ''),
    '    lsr_entries_with_points:  ' + (counters.lsr_entries_with_points != null ? counters.lsr_entries_with_points : ''),
    '    lsr_matches_inserted:     ' + (counters.lsr_matches_inserted != null ? counters.lsr_matches_inserted : ''),
    '  Timing:',
  ];
  const timingLabels = ['fetch_nws_ms', 'upsert_alerts_ms', 'zips_ms', 'impact_ms', 'lsr_ms', 'total_ms'];
  timingLabels.forEach((k) => {
    const v = timings[k] != null ? timings[k] : (k === 'total_ms' && timings.duration_ms != null ? timings.duration_ms : '');
    lines.push('    ' + String(k).padEnd(pad - 6) + (v !== '' ? v + ' ms' : ''));
  });
  lines.push('  Exit:');
  lines.push('    success:              ' + (success === true));
  lines.push('    errors_count:         ' + (errorsCount != null ? errorsCount : 0));
  lines.push('    rate_limit_retries:   ' + (rateLimitRetries != null ? rateLimitRetries : 0));
  lines.forEach((line) => console.log(line));
}

/** Single-line JSON summary only when LOG_LEVEL=trace (for machine parsing). */
function traceJsonSummary(obj) {
  if (!isTrace()) return;
  console.log(JSON.stringify(obj));
}

/** Log error message only when debug or trace (avoid noise in info). */
function errorMsg(msg) {
  if (!msg) return;
  if (isDebug()) console.log('  [error] ' + String(msg));
}

/** One-line message when poll mode starts. */
function pollStarted(intervalSeconds) {
  console.log('AI-STORMS NWS INGEST RUN (poll mode, interval ' + (intervalSeconds != null ? intervalSeconds : '') + 's)');
}

/** Fatal error (always printed, e.g. before process exit). */
function fatal(msg) {
  if (msg != null && String(msg).trim()) console.log('[fatal] ' + String(msg).trim());
}

/** One line only when LOG_LEVEL=debug or trace. */
function debugLine(msg) {
  if (!msg) return;
  if (isDebug()) console.log('  ' + String(msg));
}

module.exports = {
  runHeader,
  alertLine,
  geoLine,
  lsrSummaryLine,
  alertStateLine,
  alertDetailsDebug,
  runSummary,
  traceJsonSummary,
  errorMsg,
  pollStarted,
  fatal,
  debugLine,
  isDebug,
  isTrace,
  safe,
  iso,
  LOG_ZIP_SAMPLE_SIZE,
  LOG_ZIP_FULL,
  LOG_ZIP_FULL_MAX,
};
