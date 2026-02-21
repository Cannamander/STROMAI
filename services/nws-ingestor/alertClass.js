/**
 * Derive alert_class, geo_method, zip_inference_method for the damage likelihood console.
 * Used at ingest and testable in isolation.
 */

/**
 * Derive alert_class from event string.
 * @param {string} event - NWS event (e.g. "Severe Thunderstorm Warning")
 * @returns {'warning'|'watch'|'advisory'|'statement'|'other'}
 */
function deriveAlertClass(event) {
  if (!event || typeof event !== 'string') return 'other';
  const e = event.trim();
  if (/Warning\b/i.test(e)) return 'warning';
  if (/Watch\b/i.test(e)) return 'watch';
  if (/Advisory\b/i.test(e)) return 'advisory';
  if (/Statement\b/i.test(e)) return 'statement';
  return 'other';
}

/**
 * Derive geo_method from geom_present and UGC codes.
 * polygon if geom_present; else zone if any UGC contains 'Z', else county if any contains 'C'; else unknown.
 * @param {boolean} geom_present
 * @param {string[]} ugcCodes - e.g. ['TXC123', 'TXZ001']
 * @returns {'polygon'|'zone'|'county'|'unknown'}
 */
function deriveGeoMethod(geom_present, ugcCodes) {
  if (geom_present) return 'polygon';
  if (!Array.isArray(ugcCodes) || ugcCodes.length === 0) return 'unknown';
  const hasZ = ugcCodes.some((c) => String(c).toUpperCase().includes('Z'));
  const hasC = ugcCodes.some((c) => String(c).toUpperCase().includes('C'));
  if (hasZ) return 'zone';
  if (hasC) return 'county';
  return 'unknown';
}

/**
 * Derive zip_inference_method.
 * @param {boolean} geom_present
 * @param {number} zip_count
 * @returns {'polygon_intersect'|'none'}
 */
function deriveZipInferenceMethod(geom_present, zip_count) {
  if (geom_present && (zip_count ?? 0) > 0) return 'polygon_intersect';
  return 'none';
}

/**
 * Compute zip_density (zip_count / area_sq_miles). Handles divide-by-zero.
 * @param {number} zip_count
 * @param {number|null|undefined} area_sq_miles
 * @returns {number|null} null when area missing or zero
 */
function computeZipDensity(zip_count, area_sq_miles) {
  const area = area_sq_miles != null && Number(area_sq_miles) > 0 ? Number(area_sq_miles) : null;
  if (area == null) return null;
  const count = zip_count != null ? Number(zip_count) : 0;
  return count / area;
}

module.exports = {
  deriveAlertClass,
  deriveGeoMethod,
  deriveZipInferenceMethod,
  computeZipDensity,
};
