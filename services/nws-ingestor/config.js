require('dotenv').config();

const DEFAULT_EVENTS = [
  'Severe Thunderstorm Warning',
  'Tornado Warning',
  'Flash Flood Warning',
  'High Wind Warning',
];

function parseEvents(envValue) {
  if (!envValue || typeof envValue !== 'string') return DEFAULT_EVENTS;
  return envValue.split(',').map((s) => s.trim()).filter(Boolean);
}

/** NWS_STATES overrides NWS_AREA. Source of truth for multi-state polling. */
function parseStates() {
  if (process.env.NWS_STATES != null && String(process.env.NWS_STATES).trim() !== '') {
    return process.env.NWS_STATES
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => s.toUpperCase());
  }
  if (process.env.NWS_AREA != null && String(process.env.NWS_AREA).trim() !== '') {
    return [process.env.NWS_AREA.trim().toUpperCase()];
  }
  return ['TX'];
}

const nwsStates = parseStates();

module.exports = {
  databaseUrl: process.env.DATABASE_URL,
  nwsBaseUrl: (process.env.NWS_BASE_URL || 'https://api.weather.gov').replace(/\/$/, ''),
  nwsUserAgent: process.env.NWS_USER_AGENT || 'AI-STORMS (https://creativedash.ai, tavis@creativedash.ai)',
  nwsPollSeconds: Math.max(60, parseInt(process.env.NWS_POLL_SECONDS, 10) || 120),
  nwsArea: process.env.NWS_AREA || 'TX',
  nwsStates,
  allowedEvents: parseEvents(process.env.NWS_EVENTS),
  includeWatch: process.env.INCLUDE_WATCH === 'true' || process.env.INCLUDE_WATCH === '1',
  logLevel: process.env.LOG_LEVEL || 'info',
  dryRun: process.env.DRY_RUN === 'true' || process.env.DRY_RUN === '1',
};
