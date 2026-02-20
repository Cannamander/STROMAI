'use strict';
/**
 * Parse LSR product text: extract hail, wind gust, optional timestamp, raw lines.
 * Regex-only, no NLP. Returns array of lsr_entries.
 */

// Hail: "HAIL 2.00 IN", "HAIL 1.25 IN", "HAIL 1.25"
const HAIL_RE = /HAIL\s+(\d+(?:\.\d+)?)\s*(?:IN\.?)?/gi;
// Wind gust: "TSTM WND GST 70 MPH", "WND GST 58 MPH"
const WIND_GUST_RE = /(?:TSTM\s+)?WND\s+GST\s+(\d+)\s*MPH/gi;
// Best-effort time in line: common patterns like "0153 PM CDT" or "1:53 PM" or "15:53 UTC"
const TIME_RE = /(\d{1,2})(?::(\d{2}))?\s*(AM|PM|UTC|CDT|CST|EDT|EST|MDT|MST|PDT|PST)\b/i;

/**
 * Parse a single line (or concatenated report line) for hail and wind.
 * @param {string} line
 * @returns {{ hail_in: number|null, wind_gust_mph: number|null, raw_text: string }}
 */
function parseLine(line) {
  const raw_text = String(line || '').trim();
  let hail_in = null;
  let wind_gust_mph = null;

  const hailMatch = HAIL_RE.exec(raw_text);
  if (hailMatch) {
    hail_in = parseFloat(hailMatch[1]);
    HAIL_RE.lastIndex = 0;
  }
  const windMatch = WIND_GUST_RE.exec(raw_text);
  if (windMatch) {
    wind_gust_mph = parseInt(windMatch[1], 10);
    WIND_GUST_RE.lastIndex = 0;
  }

  return { hail_in, wind_gust_mph, raw_text };
}

/**
 * Try to parse a time from a line; returns Date or null.
 * @param {string} line
 * @param {Date} productIssuanceTime - fallback when no time in line
 */
function parseTimeFromLine(line, productIssuanceTime) {
  const m = line.match(TIME_RE);
  if (!m) return productIssuanceTime ? new Date(productIssuanceTime) : null;
  let hour = parseInt(m[1], 10);
  const min = m[2] ? parseInt(m[2], 10) : 0;
  const ampm = (m[3] || '').toUpperCase();
  if (ampm === 'PM' && hour < 12) hour += 12;
  if (ampm === 'AM' && hour === 12) hour = 0;
  if (['CDT', 'EDT', 'MDT', 'PDT'].includes(ampm) && hour < 12) hour += 12;
  if (['CDT', 'EDT', 'MDT', 'PDT'].includes(ampm) && hour === 12) hour = 12;
  const d = productIssuanceTime ? new Date(productIssuanceTime) : new Date();
  d.setHours(hour, min, 0, 0);
  return d;
}

/**
 * Extract lat/lon from a line if present. Common LSR format: "LAT... LON..." or "(32.12, -97.45)" or "32.12 -97.45"
 * @param {string} line
 * @returns {{ lat: number, lon: number } | null}
 */
function parseLatLonFromLine(line) {
  const s = String(line || '');
  const pair = s.match(/(-?\d{1,3}\.\d+)\s*[,]\s*(-?\d{1,3}\.\d+)/);
  if (pair) {
    const lat = parseFloat(pair[1]);
    const lon = parseFloat(pair[2]);
    if (lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180) return { lat, lon };
  }
  const space = s.match(/(-?\d{1,3}\.\d+)\s+(-?\d{1,3}\.\d+)/);
  if (space) {
    const lat = parseFloat(space[1]);
    const lon = parseFloat(space[2]);
    if (lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180) return { lat, lon };
  }
  return null;
}

/**
 * Split product text into logical lines (NWS LSR often has one report per line or segment).
 * Then parse each line for hail, wind, time, lat/lon.
 * @param {string} productText - full product body
 * @param {string} productId
 * @param {Date|string} issuanceTime
 * @returns {Array<{ hail_in: number|null, wind_gust_mph: number|null, entry_time: Date|null, raw_text: string, lat: number|null, lon: number|null }>}
 */
function parseLsrProduct(productText, productId, issuanceTime) {
  const entries = [];
  const issued = issuanceTime ? new Date(issuanceTime) : null;
  const lines = String(productText || '')
    .split(/\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !/^[\.\*\-\s]+$/.test(l));

  for (const line of lines) {
    const { hail_in, wind_gust_mph, raw_text } = parseLine(line);
    const hasHailOrWind = hail_in != null || wind_gust_mph != null;
    if (!hasHailOrWind) continue;
    const entry_time = parseTimeFromLine(line, issued);
    const coords = parseLatLonFromLine(line);
    entries.push({
      hail_in: hail_in ?? null,
      wind_gust_mph: wind_gust_mph ?? null,
      entry_time,
      raw_text: raw_text || line,
      lat: coords ? coords.lat : null,
      lon: coords ? coords.lon : null,
    });
  }

  return entries;
}

module.exports = {
  parseLine,
  parseTimeFromLine,
  parseLatLonFromLine,
  parseLsrProduct,
  HAIL_RE,
  WIND_GUST_RE,
};
