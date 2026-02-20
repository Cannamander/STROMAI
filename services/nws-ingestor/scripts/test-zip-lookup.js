#!/usr/bin/env node
'use strict';
/**
 * Fake a weather-event geometry and run PostGIS ZIP lookup to verify GIS logic.
 * Usage: npm run nws:test-zips   or   node services/nws-ingestor/scripts/test-zip-lookup.js
 * Requires: DATABASE_URL in .env, and public.zcta5_raw with geom + zcta5ce20.
 */
require('dotenv').config();
const { getZipsByGeometry, closePool } = require('../db');

// Small box over downtown Houston (WGS84). Should intersect 77002 and possibly adjacent ZCTAs.
const FAKE_POLYGON_HOUSTON = {
  type: 'Polygon',
  coordinates: [
    [
      [-95.38, 29.75],
      [-95.35, 29.75],
      [-95.35, 29.77],
      [-95.38, 29.77],
      [-95.38, 29.75],
    ],
  ],
};

// Small box over Dallas (WGS84). Should intersect one or more Dallas ZCTAs.
const FAKE_POLYGON_DALLAS = {
  type: 'Polygon',
  coordinates: [
    [
      [-96.82, 32.77],
      [-96.78, 32.77],
      [-96.78, 32.80],
      [-96.82, 32.80],
      [-96.82, 32.77],
    ],
  ],
};

async function main() {
  console.log('Fake weather geometry → PostGIS ZIP lookup (ZCTA intersection)\n');

  for (const [label, geom] of [
    ['Houston (downtown box)', FAKE_POLYGON_HOUSTON],
    ['Dallas (downtown box)', FAKE_POLYGON_DALLAS],
  ]) {
    process.stdout.write(label + ' → ');
    try {
      const zips = await getZipsByGeometry(geom);
      console.log('zips =', zips.length ? zips.join(', ') : '(none)');
    } catch (e) {
      console.log('ERROR:', e.message);
    }
  }

  await closePool();
  console.log('\nDone. If you see ZIPs above, GIS logic is working.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
