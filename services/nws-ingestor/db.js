require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

const UPSERT_SQL = `
INSERT INTO public.nws_alerts (
  id, event, severity, certainty, urgency, headline, area_desc,
  sent, effective, onset, expires, ends,
  geometry_json, raw_json, source, first_seen_at, last_seen_at, processed
)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, now(), now(), false)
ON CONFLICT (id) DO UPDATE SET
  event = EXCLUDED.event,
  severity = EXCLUDED.severity,
  certainty = EXCLUDED.certainty,
  urgency = EXCLUDED.urgency,
  headline = EXCLUDED.headline,
  area_desc = EXCLUDED.area_desc,
  sent = EXCLUDED.sent,
  effective = EXCLUDED.effective,
  onset = EXCLUDED.onset,
  expires = EXCLUDED.expires,
  ends = EXCLUDED.ends,
  geometry_json = EXCLUDED.geometry_json,
  raw_json = EXCLUDED.raw_json,
  last_seen_at = now();
`;

const SOURCE = 'nws-ingestor';

/**
 * @param {object[]} rows - Normalized rows from normalize.js
 * @returns {Promise<{ inserted_count: number, updated_count: number }>}
 */
async function upsertAlerts(rows) {
  if (!rows || rows.length === 0) {
    return { inserted_count: 0, updated_count: 0 };
  }

  const ids = rows.map((r) => r.id);
  const existingResult = await pool.query(
    'SELECT id FROM public.nws_alerts WHERE id = ANY($1::text[])',
    [ids]
  );
  const existingSet = new Set(existingResult.rows.map((r) => r.id));

  for (const row of rows) {
    await pool.query(UPSERT_SQL, [
      row.id,
      row.event,
      row.severity,
      row.certainty,
      row.urgency,
      row.headline,
      row.area_desc,
      row.sent,
      row.effective,
      row.onset,
      row.expires,
      row.ends,
      row.geometry_json == null ? null : JSON.stringify(row.geometry_json),
      row.raw_json == null ? null : JSON.stringify(row.raw_json),
      SOURCE,
    ]);
  }

  const updated_count = existingSet.size;
  const inserted_count = rows.length - updated_count;
  return { inserted_count, updated_count };
}

// PostGIS: NWS GeoJSON (WGS84/4326) → ZCTA intersection. zcta5_raw.geom is SRID 4269 (NAD83); we transform
// input to 4269 so both sides match and the GIST index on geom can be used. Parameterized ($1) only.
const ZIPS_INTERSECT_SQL = `
  SELECT DISTINCT zcta5ce20
  FROM public.zcta5_raw
  WHERE ST_Intersects(
    geom,
    ST_Transform(ST_SetSRID(ST_GeomFromGeoJSON($1::text), 4326), 4269)
  )
`;

/** Build query params for ZIP intersection (for testing and for getZipsByGeometry). No string concat. */
function getZipsQueryParams(geojsonGeometry) {
  if (geojsonGeometry == null || typeof geojsonGeometry !== 'object') return [];
  return [JSON.stringify(geojsonGeometry)];
}

/**
 * Resolve impacted ZIPs (zcta5ce20) by spatial intersection with NWS alert geometry.
 * @param {object|null} geojsonGeometry - GeoJSON geometry (Polygon, MultiPolygon, etc.)
 * @returns {Promise<string[]>} Unique list of ZIP strings
 */
async function getZipsByGeometry(geojsonGeometry) {
  const params = getZipsQueryParams(geojsonGeometry);
  if (params.length === 0) return [];
  const { rows } = await pool.query(ZIPS_INTERSECT_SQL, params);
  const zips = (rows || []).map((r) => r && r.zcta5ce20).filter(Boolean);
  return [...new Set(zips)];
}

const IMPACT_UPSERT_SQL = `
  INSERT INTO public.alert_impacted_zips (
    alert_id, event, headline, severity, sent, effective, expires, geom_present, zips
  )
  VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
  ON CONFLICT (alert_id) DO UPDATE SET
    zips = EXCLUDED.zips,
    expires = EXCLUDED.expires,
    headline = EXCLUDED.headline,
    severity = EXCLUDED.severity,
    geom_present = EXCLUDED.geom_present
`;

/**
 * Upsert one row into alert_impacted_zips.
 * @param {object} row - { id, event, headline, severity, sent, effective, expires, geom_present, zips }
 * @returns {Promise<'insert'|'update'>}
 */
async function upsertAlertImpactedZipsRow(row) {
  const existing = await pool.query(
    'SELECT 1 FROM public.alert_impacted_zips WHERE alert_id = $1',
    [row.id]
  );
  await pool.query(IMPACT_UPSERT_SQL, [
    row.id,
    row.event ?? null,
    row.headline ?? null,
    row.severity ?? null,
    row.sent ?? null,
    row.effective ?? null,
    row.expires ?? null,
    Boolean(row.geom_present),
    row.zips || [],
  ]);
  return existing.rows.length > 0 ? 'update' : 'insert';
}

/**
 * Upsert all actionable rows into alert_impacted_zips; call getZipsByGeometry when geom present.
 * @param {object[]} rows - Normalized rows with .geometry_json, .id, .event, etc.; each has .zips and .geom_present set by caller
 * @returns {Promise<{ inserted_count: number, updated_count: number }>}
 */
async function upsertAlertImpactedZips(rows) {
  if (!rows || rows.length === 0) return { inserted_count: 0, updated_count: 0 };
  let inserted = 0;
  let updated = 0;
  for (const row of rows) {
    const result = await upsertAlertImpactedZipsRow(row);
    if (result === 'insert') inserted++;
    else updated++;
  }
  return { inserted_count: inserted, updated_count: updated };
}

async function closePool() {
  await pool.end();
}

module.exports = {
  pool,
  upsertAlerts,
  getZipsByGeometry,
  getZipsQueryParams,
  ZIPS_INTERSECT_SQL,
  upsertAlertImpactedZips,
  closePool,
};
