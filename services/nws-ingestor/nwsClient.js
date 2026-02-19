const { fetch } = require('undici');
const config = require('./config');

const MAX_RETRIES = 3;
const INITIAL_BACKOFF_MS = 1000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Fetch active NWS alerts for the configured area with retry on 429/5xx.
 * @returns {Promise<{ type: string, features: Array }>} GeoJSON FeatureCollection
 */
async function fetchActiveAlerts() {
  const url = `${config.nwsBaseUrl}/alerts/active?status=actual&area=${encodeURIComponent(config.nwsArea)}`;
  const headers = {
    'User-Agent': config.nwsUserAgent,
    Accept: 'application/geo+json',
  };

  let lastError;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(url, { headers });
      const status = res.status;

      if (status === 429 || (status >= 500 && status < 600)) {
        const backoffMs = INITIAL_BACKOFF_MS * Math.pow(2, attempt - 1);
        if (attempt < MAX_RETRIES) {
          await sleep(backoffMs);
          continue;
        }
        throw new Error(`NWS API returned ${status} after ${MAX_RETRIES} attempts`);
      }

      if (!res.ok) {
        throw new Error(`NWS API error: ${status} ${res.statusText}`);
      }

      const data = await res.json();
      if (!data || typeof data !== 'object') {
        throw new Error('Invalid NWS response: not an object');
      }
      return data;
    } catch (err) {
      lastError = err;
      if (attempt < MAX_RETRIES) {
        const backoffMs = INITIAL_BACKOFF_MS * Math.pow(2, attempt - 1);
        await sleep(backoffMs);
      }
    }
  }

  throw lastError || new Error('Failed to fetch NWS alerts');
}

module.exports = { fetchActiveAlerts };
