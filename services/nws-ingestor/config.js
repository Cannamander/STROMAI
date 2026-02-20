require('dotenv').config();

/** Default NWS event types we treat as actionable (damaging / high-value for home services leads). */
const DEFAULT_EVENTS = [
  'Tornado Warning',
  'Severe Thunderstorm Warning',
  'Flash Flood Warning',
  'High Wind Warning',
  'Hurricane Warning',
  'Tropical Storm Warning',
  'Storm Surge Warning',
  'Blizzard Warning',
  'Ice Storm Warning',
  'Winter Storm Warning',
  'Hard Freeze Warning',
  'Freeze Warning',
  'Extreme Cold Warning',
  'Wind Chill Warning',
  'Excessive Heat Warning',
  'Winter Weather Advisory',
  'Wind Chill Advisory',
  'Frost Advisory',
  'Coastal Flood Warning',
  'Lakeshore Flood Warning',
  'Dense Fog Advisory',
];

function parseEvents(envValue) {
  if (!envValue || typeof envValue !== 'string') return DEFAULT_EVENTS;
  return envValue.split(',').map((s) => s.trim()).filter(Boolean);
}

/** Parse NWS_AREA or NWS_STATES (comma-separated state codes). Default TX if unset. */
function parseArea() {
  const raw = process.env.NWS_AREA ?? process.env.NWS_STATES ?? '';
  if (raw != null && String(raw).trim() !== '') {
    return String(raw)
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => s.toUpperCase());
  }
  return ['TX'];
}

const nwsStates = parseArea();

module.exports = {
  databaseUrl: process.env.DATABASE_URL,
  nwsBaseUrl: (process.env.NWS_BASE_URL || 'https://api.weather.gov').replace(/\/$/, ''),
  nwsUserAgent: process.env.NWS_USER_AGENT || 'AI-STORMS (https://creativedash.ai, tavis@creativedash.ai)',
  nwsPollSeconds: Math.max(60, parseInt(process.env.NWS_POLL_SECONDS, 10) || 120),
  nwsStates,
  /** @deprecated All events ingested; used only for legacy or warning-detection. */
  allowedEvents: parseEvents(process.env.NWS_EVENTS),
  includeWatch: process.env.INCLUDE_WATCH === 'true' || process.env.INCLUDE_WATCH === '1',
  logLevel: process.env.LOG_LEVEL || 'info',
  dryRun: process.env.DRY_RUN === 'true' || process.env.DRY_RUN === '1',
  lsrLookbackHours: Math.max(1, parseInt(process.env.LSR_LOOKBACK_HOURS, 10) || 48),
  lsrTimeSlopHours: Math.max(0, parseInt(process.env.LSR_TIME_SLOP_HOURS, 10) || 2),
  /** Hours before effective and after expires for LSR time window (warnings). */
  alertLsrTimeBufferHours: Math.max(0, parseInt(process.env.ALERT_LSR_TIME_BUFFER_HOURS, 10) || 2),
  /** Max distance (meters) for ST_DWithin match when geom present. */
  alertLsrDistanceMeters: Math.max(100, parseInt(process.env.ALERT_LSR_DISTANCE_METERS, 10) || 30000),
  storeSnapshots: process.env.NWS_STORE_SNAPSHOTS !== 'false' && process.env.NWS_STORE_SNAPSHOTS !== '0',
  inferZip: process.env.INFER_ZIP !== 'false' && process.env.INFER_ZIP !== '0',
  /** Delay (ms) between NWS zone geometry fetches when inferring ZIPs. Lower = faster; 0 = no delay. Default 50. */
  inferZipDelayMs: process.env.INFER_ZIP_DELAY_MS === '0' ? 0 : Math.max(0, parseInt(process.env.INFER_ZIP_DELAY_MS, 10) || 50),
  inferZipGeocode: process.env.INFER_ZIP_GEOCODE === 'true' || process.env.INFER_ZIP_GEOCODE === '1',
};
