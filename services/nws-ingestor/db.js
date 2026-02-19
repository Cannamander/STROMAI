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

async function closePool() {
  await pool.end();
}

module.exports = { pool, upsertAlerts, closePool };
