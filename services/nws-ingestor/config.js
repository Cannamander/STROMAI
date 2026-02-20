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

/** Parse NWS_STATES (comma-separated state codes). Default TX if unset. */
function parseStates() {
  if (process.env.NWS_STATES != null && String(process.env.NWS_STATES).trim() !== '') {
    return process.env.NWS_STATES
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => s.toUpperCase());
  }
  return ['TX'];
}

const nwsStates = parseStates();

module.exports = {
  databaseUrl: process.env.DATABASE_URL,
  nwsBaseUrl: (process.env.NWS_BASE_URL || 'https://api.weather.gov').replace(/\/$/, ''),
  nwsUserAgent: process.env.NWS_USER_AGENT || 'AI-STORMS (https://creativedash.ai, tavis@creativedash.ai)',
  nwsPollSeconds: Math.max(60, parseInt(process.env.NWS_POLL_SECONDS, 10) || 120),
  nwsStates,
  allowedEvents: parseEvents(process.env.NWS_EVENTS),
  includeWatch: process.env.INCLUDE_WATCH === 'true' || process.env.INCLUDE_WATCH === '1',
  logLevel: process.env.LOG_LEVEL || 'info',
  dryRun: process.env.DRY_RUN === 'true' || process.env.DRY_RUN === '1',
  lsrLookbackHours: Math.max(1, parseInt(process.env.LSR_LOOKBACK_HOURS, 10) || 12),
  lsrTimeSlopHours: Math.max(0, parseInt(process.env.LSR_TIME_SLOP_HOURS, 10) || 2),
};
