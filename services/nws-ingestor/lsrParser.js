'use strict';
/**
 * Parse LSR product text: extract hail, wind gust, optional timestamp, raw lines.
 * Also supports observation schema for nws_lsr_observations (event_type, state, county, place, observation_id).
 * Regex-only, no NLP.
 */

// Hail: "HAIL 2.00 IN", "HAIL 1.25 IN", "HAIL 1 1/2 IN"
const HAIL_RE = /HAIL\s+(\d+(?:\s+\d+\/\d+)?(?:\s*\.\d+)?)\s*(?:IN\.?)?/gi;
// Wind gust: "TSTM WND GST 70 MPH", "WND GST 58 MPH"
const WIND_GUST_RE = /(?:TSTM\s+)?WND\s+GST\s+(\d+)\s*MPH/gi;
// Wind damage: "TSTM WND DMG"
const WIND_DMG_RE = /TSTM\s+WND\s+DMG/i;
// Rain: "2.30 IN", "1 IN"
const RAIN_RE = /(\d+(?:\.\d+)?)\s*IN(?:\.?)(?:\s|$)/i;
// Temp: "85 F"
const TEMP_RE = /(\d+)\s*F\b/i;
// Best-effort time in line: common patterns like "0153 PM CDT" or "1:53 PM" or "15:53 UTC"
const TIME_RE = /(\d{1,2})(?::(\d{2}))?\s*(AM|PM|UTC|CDT|CST|EDT|EST|MDT|MST|PDT|PST)\b/i;

const US_STATE_2 = /\b(AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY|DC)\b/i;

/** Normalize LSR event type from line text. One of HAIL, TSTM_WND_DMG, TSTM_WND_GST, TORNADO, FLASH_FLOOD, HEAVY_RAIN, FUNNEL_CLOUD, ICE_STORM, FREEZING_RAIN, or UNKNOWN. */
function eventTypeFromLine(line) {
  const s = String(line || '').toUpperCase();
  if (/\bTORNADO\b/.test(s)) return 'TORNADO';
  if (/\bFLASH\s*FLOOD\b|\bFLASH FLOOD\b/.test(s)) return 'FLASH_FLOOD';
  if (/\bHEAVY\s*RAIN\b/.test(s)) return 'HEAVY_RAIN';
  if (/\bFUNNEL\b/.test(s)) return 'FUNNEL_CLOUD';
  if (/\bICE\s*STORM\b/.test(s)) return 'ICE_STORM';
  if (/\bFREEZING\s*RAIN\b/.test(s)) return 'FREEZING_RAIN';
  if (/\bHAIL\b/.test(s)) return 'HAIL';
  if (WIND_DMG_RE.test(s)) return 'TSTM_WND_DMG';
  if (/(?:TSTM\s+)?WND\s+GST\b/.test(s)) return 'TSTM_WND_GST';
  return 'UNKNOWN';
}

/** Parse hail size; handle "1 1/2" and "1.75". */
function parseHailInches(line) {
  const hailMatch = /HAIL\s+(\d+)(?:\s+(\d+)\/(\d+))?\s*(?:\.(\d+))?\s*(?:IN\.?)?/i.exec(String(line || ''));
  if (!hailMatch) return null;
  let n = parseFloat(hailMatch[1]) || 0;
  if (hailMatch[2] && hailMatch[3]) n += parseInt(hailMatch[2], 10) / parseInt(hailMatch[3], 10);
  if (hailMatch[4]) n = parseFloat(hailMatch[1] + '.' + hailMatch[4]);
  return n;
}

/** Parse rain inches from line. */
function parseRainInches(line) {
  const m = String(line || '').match(/(\d+(?:\.\d+)?)\s*IN(?:\.?)(?:\s|$)/i);
  return m ? parseFloat(m[1]) : null;
}

/** Parse temp F from line. */
function parseTempF(line) {
  const m = String(line || '').match(/(\d+)\s*F\b/i);
  return m ? parseInt(m[1], 10) : null;
}

/** Best-effort state (2-letter) from line; place = segment before state. */
function parseStateCountyPlace(line) {
  const s = String(line || '').trim();
  const stateMatch = s.match(US_STATE_2);
  const state = stateMatch ? stateMatch[1].toUpperCase() : null;
  const place = s.length > 100 ? s.slice(0, 100).trim() : s;
  return { state, county: null, place: place || null };
}

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

/**
 * Parse LSR product into observation rows for nws_lsr_observations (idempotent upsert by observation_id).
 * Event types: HAIL, TSTM_WND_DMG, TSTM_WND_GST, TORNADO, FLASH_FLOOD, HEAVY_RAIN, FUNNEL_CLOUD, ICE_STORM, FREEZING_RAIN.
 * @param {string} productText - full product body
 * @param {string} productId
 * @param {Date|string|null} issuanceTime
 * @param {string|null} wfo - optional WFO id
 * @returns {Array<{ observation_id, product_id, issued_at, wfo, event_type, occurred_at, state, county, place, hail_inches, wind_mph, rain_inches, temp_f, lon, lat, raw_line_text, occurred_time_confidence }>}
 */
function parseLsrProductToObservations(productText, productId, issuanceTime, wfo = null) {
  const observations = [];
  const issued = issuanceTime ? new Date(issuanceTime) : null;
  const lines = String(productText || '')
    .split(/\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !/^[\.\*\-\s]+$/.test(l));

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const event_type = eventTypeFromLine(line);
    const { hail_in, wind_gust_mph } = parseLine(line);
    const hail_inches = parseHailInches(line) ?? hail_in ?? null;
    const wind_mph = wind_gust_mph ?? null;
    const hasHailOrWind = hail_inches != null || wind_mph != null;
    if (event_type === 'UNKNOWN' && !hasHailOrWind) continue;

    const occurred_at = parseTimeFromLine(line, issued);
    const time_confidence = line.match(TIME_RE) ? 'high' : (issued ? 'low' : null);
    const coords = parseLatLonFromLine(line);
    const { state, county, place } = parseStateCountyPlace(line);
    const rain_inches = parseRainInches(line);
    const temp_f = parseTempF(line);

    const ts = occurred_at ? occurred_at.getTime() : i;
    const observation_id = `${productId}_${i}_${ts}`;

    observations.push({
      observation_id,
      product_id: productId,
      issued_at: issued ? issued.toISOString() : null,
      wfo: wfo || null,
      event_type,
      occurred_at: occurred_at ? occurred_at.toISOString() : null,
      state,
      county,
      place,
      hail_inches,
      wind_mph,
      rain_inches,
      temp_f,
      lon: coords ? coords.lon : null,
      lat: coords ? coords.lat : null,
      raw_line_text: line,
      occurred_time_confidence: time_confidence,
    });
  }

  return observations;
}

module.exports = {
  parseLine,
  parseTimeFromLine,
  parseLatLonFromLine,
  parseLsrProduct,
  parseLsrProductToObservations,
  eventTypeFromLine,
  HAIL_RE,
  WIND_GUST_RE,
};
