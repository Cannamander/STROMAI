'use strict';
const { fetch } = require('undici');
const config = require('./config');

/** NWS zone types: Z = forecast zone, C = county. API path segment. */
const ZONE_TYPE_PATH = { Z: 'forecast', C: 'county' };

/**
 * Fetch zone geometry from NWS API. Tries forecast then county for the given UGC.
 * @param {string} ugc - UGC code (e.g. NJZ001, NJC017)
 * @returns {Promise<object|null>} GeoJSON geometry or null
 */
async function fetchZoneGeometry(ugc) {
  const code = String(ugc).trim().toUpperCase();
  if (code.length < 6) return null;
  const typeChar = code.charAt(2);
  const path = ZONE_TYPE_PATH[typeChar] || 'forecast';
  const url = `${config.nwsBaseUrl}/zones/${path}/${code}`;
  try {
    const res = await fetch(url, {
      headers: { Accept: 'application/geo+json', 'User-Agent': config.nwsUserAgent },
    });
    if (!res.ok) {
      if (res.status === 404 && path === 'forecast' && typeChar !== 'C') {
        const countyRes = await fetch(`${config.nwsBaseUrl}/zones/county/${code}`, {
          headers: { Accept: 'application/geo+json', 'User-Agent': config.nwsUserAgent },
        });
        if (!countyRes.ok) return null;
        const countyData = await countyRes.json();
        return countyData.geometry ?? null;
      }
      return null;
    }
    const data = await res.json();
    return data.geometry ?? null;
  } catch (_) {
    return null;
  }
}

module.exports = { fetchZoneGeometry };
