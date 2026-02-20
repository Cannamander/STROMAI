const config = require('./config');

/** US state/territory 2-letter codes used in NWS UGC (first 2 chars of UGC). */
const UGC_STATE_CODES = new Set([
  'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY','DC','PR','VI','GU','AS','MP','GM','LC','PH','AM','AN','AQ','CR','CQ','PZ','LH','LM','PM','PK',
]);

/**
 * Parse ISO timestamp string to Date or null.
 * @param {string|null|undefined} value
 * @returns {Date|null}
 */
function parseTimestamp(value) {
  if (value == null || value === '') return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Extract state codes from NWS alert geocode (UGC / FIPS6).
 * UGC format: 6 chars = 2 state + 1 type + 3 number (e.g. NJC017 = NJ county 017).
 * FIPS6: 5-digit county FIPS, first 2 digits = state FIPS (e.g. 34017 = NJ).
 * @param {object} props - feature.properties
 * @returns {string[]} Sorted unique state codes
 */
function statesFromGeocode(props) {
  const states = new Set();
  const geocode = props && props.geocode;
  if (!geocode || typeof geocode !== 'object') return [];

  // UGC: array of strings like "NJC017", "PAC013"
  const ugc = geocode.UGC || geocode.ugc;
  if (Array.isArray(ugc)) {
    for (const code of ugc) {
      const s = String(code).trim().toUpperCase().slice(0, 2);
      if (s.length === 2 && UGC_STATE_CODES.has(s)) states.add(s);
    }
  }

  // FIPS/SAME (county): 5- or 6-digit, first 2 = state FIPS; map to state code
  const fipsState = {
    '01':'AL','02':'AK','04':'AZ','05':'AR','06':'CA','08':'CO','09':'CT','10':'DE','11':'DC','12':'FL','13':'GA','15':'HI','16':'ID','17':'IL','18':'IN','19':'IA','20':'KS','21':'KY','22':'LA','23':'ME','24':'MD','25':'MA','26':'MI','27':'MN','28':'MS','29':'MO','30':'MT','31':'NE','32':'NV','33':'NH','34':'NJ','35':'NM','36':'NY','37':'NC','38':'ND','39':'OH','40':'OK','41':'OR','42':'PA','44':'RI','45':'SC','46':'SD','47':'TN','48':'TX','49':'UT','50':'VT','51':'VA','53':'WA','54':'WV','55':'WI','56':'WY','72':'PR',
  };
  for (const key of ['FIPS6', 'fips6', 'SAME', 'same']) {
    const arr = geocode[key];
    if (Array.isArray(arr)) {
      for (const code of arr) {
        const f = String(code).trim().slice(0, 2);
        if (fipsState[f]) states.add(fipsState[f]);
      }
    }
  }

  return [...states].sort();
}

/**
 * Extract labeled location data from NWS alert properties for readout.
 * Returns only keys that have values. NWS may send: areaDesc, geocode (UGC, SAME), county, city, etc.
 * @param {object} props - feature.properties
 * @returns {{ state?: string, county?: string, city?: string, area?: string, zone?: string }}
 */
function locationFromProps(props) {
  const out = {};
  if (!props || typeof props !== 'object') return out;

  const states = statesFromGeocode(props);
  if (states.length > 0) out.state = states.join(',');

  const geocode = props.geocode;
  if (geocode && typeof geocode === 'object') {
    const ugc = geocode.UGC || geocode.ugc;
    if (Array.isArray(ugc) && ugc.length > 0) {
      out.zone = ugc.map((c) => String(c).trim()).filter(Boolean).join(',');
    }
  }

  const county = props.county || props.counties;
  if (county != null) {
    const arr = Array.isArray(county) ? county : [county];
    const s = arr.map((c) => String(c).trim()).filter(Boolean).join(',');
    if (s) out.county = s;
  }

  const city = props.city || props.place || props.cities;
  if (city != null) {
    const arr = Array.isArray(city) ? city : [city];
    const s = arr.map((c) => String(c).trim()).filter(Boolean).join(',');
    if (s) out.city = s;
  }

  const areaDesc = props.areaDesc ?? props.area_desc ?? props.area;
  if (areaDesc != null && String(areaDesc).trim()) {
    out.area = String(areaDesc).replace(/\n/g, ' ').trim();
  }

  return out;
}

/**
 * Normalize a GeoJSON feature from NWS alerts to our DB row shape.
 * @param {object} feature - GeoJSON feature (properties + geometry)
 * @returns {object|null} Normalized row or null if missing id
 */
function normalizeFeature(feature) {
  if (!feature || typeof feature !== 'object') return null;
  const props = feature.properties || {};
  const id = props.id ?? props['@id'] ?? feature.id ?? null;
  if (!id || typeof id !== 'string') return null;

  const sent = parseTimestamp(props.sent);
  const effective = parseTimestamp(props.effective);
  const onset = parseTimestamp(props.onset);
  const expires = parseTimestamp(props.expires);
  const ends = parseTimestamp(props.ends);

  const states = statesFromGeocode(props);
  const location = locationFromProps(props);

  return {
    id: String(id).trim(),
    event: props.event ?? null,
    status: props.status ?? null,
    messageType: props.messageType ?? null,
    severity: props.severity ?? null,
    certainty: props.certainty ?? null,
    urgency: props.urgency ?? null,
    headline: props.headline ?? null,
    area_desc: props.areaDesc ?? props.area_desc ?? null,
    states,
    /** Labeled location for readout: { state, county, city, area, zone } (only keys with values). */
    location,
    sent,
    effective,
    onset,
    expires,
    ends,
    geometry_json: feature.geometry ?? null,
    raw_json: feature,
  };
}

/**
 * Filter normalized rows: allowed event types and future expires.
 * @param {object[]} rows
 * @returns {object[]}
 */
function filterRows(rows) {
  const allowed = new Set(config.allowedEvents.map((e) => e.trim()));
  const now = new Date();
  return rows.filter((row) => {
    if (!row || !row.id) return false;
    if (!allowed.has(String(row.event || '').trim())) return false;
    if (row.expires != null && row.expires <= now) return false;
    return true;
  });
}

module.exports = { normalizeFeature, filterRows };
