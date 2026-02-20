const { fetch } = require('undici');
const config = require('./config');

const MAX_RETRIES = 3;
const INITIAL_BACKOFF_MS = 1000;
/** Max states per request to avoid huge URLs (server/proxy limits). */
const STATES_PER_REQUEST = 10;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function featureId(f) {
  return f?.properties?.id ?? f?.properties?.['@id'] ?? f?.id ?? JSON.stringify(f);
}

/**
 * Fetch one request for a slice of states. NWS API: ?status=actual&area=TX&area=OK&...
 */
async function fetchOne(statesSlice, headers) {
  const areaParams = statesSlice.map((s) => `area=${encodeURIComponent(s)}`).join('&');
  const url = `${config.nwsBaseUrl}/alerts/active?status=actual&${areaParams}`;
  if (config.logLevel === 'debug') {
    console.error('[nwsClient] GET', url.slice(0, 120) + (url.length > 120 ? '...' : ''));
  }
  const res = await fetch(url, { headers });
  if (res.status === 429 || (res.status >= 500 && res.status < 600)) {
    throw new Error(`NWS API ${res.status}`);
  }
  if (!res.ok) {
    throw new Error(`NWS API error: ${res.status} ${res.statusText}`);
  }
  const data = await res.json();
  if (!data || typeof data !== 'object') {
    throw new Error('Invalid NWS response: not an object');
  }
  return data;
}

/**
 * Fetch active NWS alerts for the configured state(s) with retry on 429/5xx.
 * Requests are chunked (STATES_PER_REQUEST per request) to avoid URL length limits, then merged and deduped.
 * @returns {Promise<{ type: string, features: Array }>} GeoJSON FeatureCollection
 */
async function fetchActiveAlerts() {
  const states = config.nwsStates;
  const headers = {
    'User-Agent': config.nwsUserAgent,
    Accept: 'application/geo+json',
  };

  const seenIds = new Set();
  const allFeatures = [];

  for (let i = 0; i < states.length; i += STATES_PER_REQUEST) {
    const slice = states.slice(i, i + STATES_PER_REQUEST);
    let lastError;
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        const data = await fetchOne(slice, headers);
        const features = Array.isArray(data.features) ? data.features : [];
        for (const f of features) {
          const id = featureId(f);
          if (!seenIds.has(id)) {
            seenIds.add(id);
            allFeatures.push(f);
          }
        }
        break;
      } catch (err) {
        lastError = err;
        if (attempt < MAX_RETRIES && (err.message.includes('429') || err.message.includes('5'))) {
          const backoffMs = INITIAL_BACKOFF_MS * Math.pow(2, attempt - 1);
          await sleep(backoffMs);
        } else {
          throw lastError || new Error('Failed to fetch NWS alerts');
        }
      }
    }
  }

  return { type: 'FeatureCollection', features: allFeatures };
}

module.exports = { fetchActiveAlerts };
