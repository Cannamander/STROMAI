require('dotenv').config();
const { Pool } = require('pg');
const crypto = require('crypto');

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
 * @returns {Promise<{ inserted_count: number, updated_count: number, resultById: Record<string, 'insert'|'update'> }>}
 */
async function upsertAlerts(rows) {
  if (!rows || rows.length === 0) {
    return { inserted_count: 0, updated_count: 0, resultById: {} };
  }

  const ids = rows.map((r) => r.id);
  const existingResult = await pool.query(
    'SELECT id FROM public.nws_alerts WHERE id = ANY($1::text[])',
    [ids]
  );
  const existingSet = new Set(existingResult.rows.map((r) => r.id));
  const resultById = {};
  for (const row of rows) {
    resultById[row.id] = existingSet.has(row.id) ? 'update' : 'insert';
  }

  await Promise.all(
    rows.map((row) =>
      pool.query(UPSERT_SQL, [
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
      ])
    )
  );

  const updated_count = existingSet.size;
  const inserted_count = rows.length - updated_count;
  return { inserted_count, updated_count, resultById };
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

// Point (lon, lat WGS84) → ZCTA(s) containing that point. Uses same SRID transform as ZCTA table.
const ZIPS_BY_POINT_SQL = `
  SELECT DISTINCT zcta5ce20
  FROM public.zcta5_raw
  WHERE ST_Contains(
    geom,
    ST_Transform(ST_SetSRID(ST_MakePoint($1::double precision, $2::double precision), 4326), 4269)
  )
`;

/**
 * Resolve ZCTA(s) that contain a point (for inferred ZIP from city/state geocode).
 * @param {number} lon - Longitude WGS84
 * @param {number} lat - Latitude WGS84
 * @returns {Promise<string[]>}
 */
async function getZipsByPoint(lon, lat) {
  if (lon == null || lat == null || Number.isNaN(Number(lon)) || Number.isNaN(Number(lat))) return [];
  const { rows } = await pool.query(ZIPS_BY_POINT_SQL, [Number(lon), Number(lat)]);
  const zips = (rows || []).map((r) => r && r.zcta5ce20).filter(Boolean);
  return [...new Set(zips)];
}

/**
 * Resolve ZIPs for NWS UGC codes (e.g. NJC017, NYZ007) from lookup table ugc_zips.
 * Table must be populated (e.g. from Census county–ZCTA data). Returns [] if table missing or no match.
 * @param {string[]} ugcCodes - UGC strings (e.g. ['NJC017', 'NJC027']
 * @returns {Promise<string[]>}
 */
async function getZipsByUgc(ugcCodes) {
  if (!ugcCodes || ugcCodes.length === 0) return [];
  const codes = ugcCodes.map((c) => String(c).trim().toUpperCase()).filter(Boolean);
  if (codes.length === 0) return [];
  try {
    const { rows } = await pool.query(
      'SELECT zips FROM public.ugc_zips WHERE ugc = ANY($1::text[])',
      [codes]
    );
    const all = (rows || []).flatMap((r) => (Array.isArray(r.zips) ? r.zips : [])).filter(Boolean);
    return [...new Set(all)];
  } catch (_) {
    return [];
  }
}

/**
 * Cache UGC → ZIP list in ugc_zips (e.g. after resolving from NWS zone geometry). Ignores errors.
 * @param {string} ugc
 * @param {string[]} zips
 */
async function insertUgcZips(ugc, zips) {
  if (!ugc || typeof ugc !== 'string') return;
  const code = ugc.trim().toUpperCase();
  const arr = Array.isArray(zips) ? zips.filter(Boolean) : [];
  try {
    await pool.query(
      'INSERT INTO public.ugc_zips (ugc, zips) VALUES ($1, $2) ON CONFLICT (ugc) DO UPDATE SET zips = EXCLUDED.zips',
      [code, arr]
    );
  } catch (_) {
    // table may not exist
  }
}

const IMPACT_UPSERT_SQL = `
  INSERT INTO public.alert_impacted_zips (
    alert_id, event, headline, severity, sent, effective, expires, geom_present, zips,
    impacted_states, zip_count
  )
  VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
  ON CONFLICT (alert_id) DO UPDATE SET
    zips = EXCLUDED.zips,
    expires = EXCLUDED.expires,
    headline = EXCLUDED.headline,
    severity = EXCLUDED.severity,
    geom_present = EXCLUDED.geom_present,
    impacted_states = EXCLUDED.impacted_states,
    zip_count = EXCLUDED.zip_count
`;

/**
 * Upsert one row into alert_impacted_zips.
 * @param {object} row - { id, event, headline, severity, sent, effective, expires, geom_present, zips, impacted_states }
 * @returns {Promise<'insert'|'update'>}
 */
async function upsertAlertImpactedZipsRow(row) {
  const existing = await pool.query(
    'SELECT 1 FROM public.alert_impacted_zips WHERE alert_id = $1',
    [row.id]
  );
  const zips = row.zips || [];
  const zip_count = Array.isArray(zips) ? zips.length : 0;
  const impacted_states = Array.isArray(row.impacted_states) ? row.impacted_states : [];
  await pool.query(IMPACT_UPSERT_SQL, [
    row.id,
    row.event ?? null,
    row.headline ?? null,
    row.severity ?? null,
    row.sent ?? null,
    row.effective ?? null,
    row.expires ?? null,
    Boolean(row.geom_present),
    zips,
    impacted_states,
    zip_count,
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
  const results = await Promise.all(rows.map((row) => upsertAlertImpactedZipsRow(row)));
  let inserted = 0;
  let updated = 0;
  for (const result of results) {
    if (result === 'insert') inserted++;
    else updated++;
  }
  return { inserted_count: inserted, updated_count: updated };
}

// LSR: point-in-polygon (alert geometry in 4326; point lon, lat). Parameterized only.
const LSR_POINT_IN_GEOM_SQL = `
  SELECT ST_Contains(
    ST_SetSRID(ST_GeomFromGeoJSON($1::text), 4326),
    ST_SetSRID(ST_MakePoint($2::double precision, $3::double precision), 4326)
  ) AS inside
`;

/**
 * Check if point (lon, lat) is inside alert GeoJSON geometry. Uses parameterized SQL.
 * @param {object} alertGeojsonGeometry - GeoJSON geometry
 * @param {number} lon
 * @param {number} lat
 * @returns {Promise<boolean>}
 */
async function lsrPointInAlertGeometry(alertGeojsonGeometry, lon, lat) {
  if (alertGeojsonGeometry == null || typeof alertGeojsonGeometry !== 'object') return false;
  const { rows } = await pool.query(LSR_POINT_IN_GEOM_SQL, [JSON.stringify(alertGeojsonGeometry), lon, lat]);
  return rows[0]?.inside === true;
}

const LSR_INSERT_SQL = `
  INSERT INTO public.nws_alert_lsr (alert_id, lsr_product_id, entry_time, point_geom, hail_in, wind_gust_mph, raw_text, raw_text_hash)
  VALUES ($1, $2, $3, ST_SetSRID(ST_MakePoint($4::double precision, $5::double precision), 4326), $6, $7, $8, $9)
`;

/**
 * Insert one LSR match row. Skips if duplicate (same alert_id, lsr_product_id, entry_time, raw_text_hash).
 * @returns {Promise<'inserted'|'skipped'>}
 */
async function insertLsrMatch(row) {
  const raw_text_hash = crypto.createHash('md5').update(row.raw_text || '').digest('hex');
  const existing = await pool.query(
    'SELECT 1 FROM public.nws_alert_lsr WHERE alert_id = $1 AND lsr_product_id = $2 AND (entry_time IS NOT DISTINCT FROM $3) AND raw_text_hash = $4',
    [row.alert_id, row.lsr_product_id, row.entry_time ?? null, raw_text_hash]
  );
  if (existing.rows.length > 0) return 'skipped';
  await pool.query(LSR_INSERT_SQL, [
    row.alert_id,
    row.lsr_product_id,
    row.entry_time ?? null,
    row.lon,
    row.lat,
    row.hail_in ?? null,
    row.wind_gust_mph ?? null,
    row.raw_text ?? null,
    raw_text_hash,
  ]);
  return 'inserted';
}

// --- LSR observations (new pipeline) ---
const LSR_OBS_UPSERT_SQL = `
  INSERT INTO public.nws_lsr_observations (
    observation_id, product_id, issued_at, wfo, event_type, occurred_at,
    state, county, place, hail_inches, wind_mph, rain_inches, temp_f,
    geom, raw_line_text, occurred_time_confidence
  )
  VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13,
    (CASE WHEN $14 IS NOT NULL AND $15 IS NOT NULL THEN ST_SetSRID(ST_MakePoint($14::float, $15::float), 4326) ELSE NULL END),
    $16, $17)
  ON CONFLICT (observation_id) DO UPDATE SET
    product_id = EXCLUDED.product_id,
    issued_at = EXCLUDED.issued_at,
    wfo = EXCLUDED.wfo,
    event_type = EXCLUDED.event_type,
    occurred_at = EXCLUDED.occurred_at,
    state = EXCLUDED.state,
    county = EXCLUDED.county,
    place = EXCLUDED.place,
    hail_inches = EXCLUDED.hail_inches,
    wind_mph = EXCLUDED.wind_mph,
    rain_inches = EXCLUDED.rain_inches,
    temp_f = EXCLUDED.temp_f,
    geom = EXCLUDED.geom,
    raw_line_text = EXCLUDED.raw_line_text,
    occurred_time_confidence = EXCLUDED.occurred_time_confidence
`;

/**
 * Upsert LSR observations into nws_lsr_observations. Idempotent by observation_id.
 * @param {object[]} rows - { observation_id, product_id, issued_at, wfo, event_type, occurred_at, state, county, place, hail_inches, wind_mph, rain_inches, temp_f, lon, lat, raw_line_text, occurred_time_confidence }
 */
async function upsertLsrObservations(rows) {
  if (!rows || rows.length === 0) return 0;
  let count = 0;
  for (const r of rows) {
    await pool.query(LSR_OBS_UPSERT_SQL, [
      r.observation_id,
      r.product_id,
      r.issued_at ?? null,
      r.wfo ?? null,
      r.event_type ?? 'UNKNOWN',
      r.occurred_at ?? null,
      r.state ?? null,
      r.county ?? null,
      r.place ?? null,
      r.hail_inches ?? null,
      r.wind_mph ?? null,
      r.rain_inches ?? null,
      r.temp_f ?? null,
      r.lon ?? null,
      r.lat ?? null,
      r.raw_line_text ?? null,
      r.occurred_time_confidence ?? null,
    ]);
    count++;
  }
  return count;
}

/**
 * Set-based LSR match: insert into nws_alert_lsr_matches for warnings with geometry.
 * Time window: effective - bufferHours to expires + bufferHours. Geography: ST_Contains or ST_DWithin. State alignment.
 * @param {number} bufferHours
 * @param {number} distanceMeters
 * @returns {Promise<{ inserted: number }>}
 */
async function runSetBasedLsrMatch(bufferHours, distanceMeters) {
  const sql = `
    WITH warnings AS (
      SELECT
        n.id AS alert_id,
        n.effective,
        n.expires,
        n.geometry_json,
        COALESCE(p.impacted_states, '{}') AS impacted_states
      FROM public.nws_alerts n
      JOIN public.alert_impacted_zips p ON p.alert_id = n.id
      WHERE (n.event LIKE '% Warning')
        AND n.geometry_json IS NOT NULL
        AND n.expires > now() - interval '1 day'
    ),
    alert_geoms AS (
      SELECT
        alert_id,
        effective,
        expires,
        impacted_states,
        ST_SetSRID(ST_GeomFromGeoJSON(geometry_json::text), 4326) AS geom
      FROM warnings
    ),
    candidates AS (
      SELECT
        a.alert_id,
        o.observation_id,
        a.geom AS alert_geom,
        o.geom AS obs_geom
      FROM alert_geoms a
      CROSS JOIN public.nws_lsr_observations o
      WHERE o.geom IS NOT NULL
        AND o.occurred_at IS NOT NULL
        AND o.occurred_at BETWEEN a.effective - ($1::numeric || ' hours')::interval
          AND a.expires + ($1::numeric || ' hours')::interval
        AND (a.impacted_states = '{}' OR o.state = ANY(a.impacted_states))
        AND (ST_Contains(a.geom, o.geom)
             OR ST_DWithin(a.geom::geography, o.geom::geography, $2))
    )
    INSERT INTO public.nws_alert_lsr_matches (alert_id, observation_id, match_method, distance_meters, match_confidence)
    SELECT
      c.alert_id,
      c.observation_id,
      CASE WHEN ST_Contains(c.alert_geom, c.obs_geom) THEN 'contains' ELSE 'dwithin' END,
      CASE WHEN NOT ST_Contains(c.alert_geom, c.obs_geom) THEN ST_Distance(c.alert_geom::geography, c.obs_geom::geography)::numeric ELSE NULL END,
      CASE WHEN ST_Contains(c.alert_geom, c.obs_geom) THEN 'high' ELSE 'medium' END
    FROM candidates c
    ON CONFLICT (alert_id, observation_id) DO NOTHING
  `;
  const result = await pool.query(sql, [bufferHours, distanceMeters]);
  return { inserted: result.rowCount ?? 0 };
}

/**
 * Update alert_impacted_zips LSR summary columns from nws_alert_lsr_matches + nws_lsr_observations.
 */
async function updateAlertLsrSummary() {
  const sql = `
    WITH agg AS (
      SELECT
        m.alert_id,
        COUNT(*)::int AS lsr_match_count,
        MAX(o.hail_inches) AS hail_max_inches,
        MAX(o.wind_mph)::int AS wind_max_mph,
        COUNT(*) FILTER (WHERE o.event_type = 'TORNADO')::int AS tornado_count,
        COUNT(*) FILTER (WHERE o.event_type IN ('FLASH_FLOOD', 'HEAVY_RAIN'))::int AS flood_count,
        COUNT(*) FILTER (WHERE (o.raw_line_text ~* 'damage|roof|tree|power|flood'))::int AS damage_keyword_hits
      FROM public.nws_alert_lsr_matches m
      JOIN public.nws_lsr_observations o ON o.observation_id = m.observation_id
      GROUP BY m.alert_id
    ),
    top_tokens AS (
      SELECT alert_id, array_agg(phrase ORDER BY ord) AS lsr_top_tokens
      FROM (
        SELECT m.alert_id, LEFT(TRIM(o.raw_line_text), 60) AS phrase,
               ROW_NUMBER() OVER (PARTITION BY m.alert_id ORDER BY o.occurred_at DESC NULLS LAST) AS ord
        FROM public.nws_alert_lsr_matches m
        JOIN public.nws_lsr_observations o ON o.observation_id = m.observation_id
        WHERE o.raw_line_text IS NOT NULL AND o.raw_line_text <> ''
      ) x
      WHERE ord <= 3
      GROUP BY alert_id
    )
    UPDATE public.alert_impacted_zips p SET
      lsr_match_count = COALESCE(a.lsr_match_count, 0),
      hail_max_inches = a.hail_max_inches,
      wind_max_mph = a.wind_max_mph,
      tornado_count = COALESCE(a.tornado_count, 0),
      flood_count = COALESCE(a.flood_count, 0),
      damage_keyword_hits = COALESCE(a.damage_keyword_hits, 0),
      lsr_top_tokens = COALESCE(t.lsr_top_tokens, '{}')
    FROM agg a
    LEFT JOIN top_tokens t ON t.alert_id = p.alert_id
    WHERE p.alert_id = a.alert_id
  `;
  await pool.query(sql);
}

/**
 * Get LSR summary fields per alert for logging (lsr_match_count, hail_max, etc.).
 * @param {string[]} alertIds
 * @returns {Promise<Array<{ alert_id: string, lsr_match_count: number, hail_max_inches: number|null, wind_max_mph: number|null, tornado_count: number, flood_count: number, damage_keyword_hits: number, lsr_top_tokens: string[] }>>}
 */
async function getAlertLsrSummaries(alertIds) {
  if (!alertIds || alertIds.length === 0) return [];
  const { rows } = await pool.query(
    `SELECT alert_id, COALESCE(lsr_match_count, 0) AS lsr_match_count, hail_max_inches, wind_max_mph,
            COALESCE(tornado_count, 0) AS tornado_count, COALESCE(flood_count, 0) AS flood_count,
            COALESCE(damage_keyword_hits, 0) AS damage_keyword_hits, COALESCE(lsr_top_tokens, '{}') AS lsr_top_tokens
     FROM public.alert_impacted_zips WHERE alert_id = ANY($1::text[])`,
    [alertIds]
  );
  return rows || [];
}

const POLL_SNAPSHOT_INSERT_SQL = `
  INSERT INTO public.nws_poll_snapshots (
    polled_at, duration_ms, fetched_count, actionable_count, geom_present_count,
    total_zips_mapped, impact_inserted, impact_updated,
    lsr_products_fetched, lsr_entries_parsed, lsr_entries_with_points, lsr_matches_inserted,
    alert_summaries
  )
  VALUES (now(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
`;

/**
 * Append one poll snapshot (one row per run). Lightweight time-series for map overlay, time windows, alerts.
 * @param {object} summary - Counts and duration from ingestOnce
 * @param {object[]} alertSummaries - Array of { id, event, headline, area_desc, expires_iso, zip_count, geom_present }
 * @returns {Promise<void>}
 */
async function insertPollSnapshot(summary, alertSummaries) {
  if (!summary) return;
  await pool.query(POLL_SNAPSHOT_INSERT_SQL, [
    summary.duration_ms ?? null,
    summary.fetched_count ?? null,
    summary.actionable_count ?? summary.actionable_kept ?? null,
    summary.geom_present_count ?? null,
    summary.total_zips_mapped ?? null,
    summary.impact_inserted ?? null,
    summary.impact_updated ?? null,
    summary.lsr_products_fetched ?? null,
    summary.lsr_entries_parsed ?? null,
    summary.lsr_entries_with_points ?? null,
    summary.lsr_matches_inserted ?? null,
    alertSummaries && alertSummaries.length > 0 ? JSON.stringify(alertSummaries) : null,
  ]);
}

async function closePool() {
  await pool.end();
}

module.exports = {
  pool,
  upsertAlerts,
  getZipsByGeometry,
  getZipsByPoint,
  getZipsByUgc,
  insertUgcZips,
  getZipsQueryParams,
  ZIPS_INTERSECT_SQL,
  upsertAlertImpactedZips,
  upsertLsrObservations,
  runSetBasedLsrMatch,
  updateAlertLsrSummary,
  getAlertLsrSummaries,
  lsrPointInAlertGeometry,
  LSR_POINT_IN_GEOM_SQL,
  insertLsrMatch,
  insertPollSnapshot,
  closePool,
};
