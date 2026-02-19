const config = require('./config');

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
