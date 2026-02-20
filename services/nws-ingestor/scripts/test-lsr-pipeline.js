#!/usr/bin/env node
'use strict';
/**
 * Test the full LSR enrichment pipeline: fetch products → parse to observations →
 * upsert nws_lsr_observations → set-based match (warnings only) → update alert summaries.
 * Prints counts and any warnings that got LSR matches.
 *
 * Usage: npm run nws:test-lsr-pipeline   or   node services/nws-ingestor/scripts/test-lsr-pipeline.js
 * Requires: .env with DATABASE_URL. NWS fetch uses NWS_BASE_URL, LSR_LOOKBACK_HOURS (default 48).
 */
require('dotenv').config();
const config = require('../config');
const { runLsrPipeline } = require('../lsrEnrich');
const { pool, closePool } = require('../db');

async function main() {
  console.log('LSR pipeline test (observations + set-based match + summary)\n');
  console.log('  LSR_LOOKBACK_HOURS:', config.lsrLookbackHours);
  console.log('  ALERT_LSR_TIME_BUFFER_HOURS:', config.alertLsrTimeBufferHours);
  console.log('  ALERT_LSR_DISTANCE_METERS:', config.alertLsrDistanceMeters);
  console.log('');

  const result = await runLsrPipeline();
  console.log('Pipeline result:');
  console.log('  lsr_products_fetched:    ', result.lsr_products_fetched);
  console.log('  lsr_observations_parsed: ', result.lsr_observations_parsed);
  console.log('  lsr_observations_upserted:', result.lsr_observations_upserted);
  console.log('  lsr_matches_inserted:    ', result.lsr_matches_inserted);
  console.log('');

  if (result.lsr_products_fetched === 0) {
    console.log('No LSR products in the lookback window. To test enrichment:');
    console.log('  - Increase LSR_LOOKBACK_HOURS (e.g. 168 for 7 days) when severe weather was recent.');
    console.log('  - Or run during/after active severe weather (NWS issues LSR products then).');
  }

  try {
    const warnings = await pool.query(
      `SELECT alert_id, event, lsr_match_count, hail_max_inches, wind_max_mph, tornado_count, flood_count
       FROM public.alert_impacted_zips
       WHERE event LIKE '% Warning'
       ORDER BY lsr_match_count DESC NULLS LAST
       LIMIT 20`
    );
    if (warnings.rows.length > 0) {
      console.log('Warnings in DB (sample, by lsr_match_count):');
      for (const r of warnings.rows) {
        const lsr = r.lsr_match_count > 0
          ? `lsr=${r.lsr_match_count} hail_max=${r.hail_max_inches ?? '-'} wind_max=${r.wind_max_mph ?? '-'}`
          : 'lsr=0';
        console.log('  ', r.alert_id, '|', r.event, '|', lsr);
      }
    } else {
      console.log('No warnings in alert_impacted_zips (only warnings get LSR enrichment).');
    }

    const obsCount = await pool.query(
      'SELECT COUNT(*) AS c FROM public.nws_lsr_observations'
    );
    const matchCount = await pool.query(
      'SELECT COUNT(*) AS c FROM public.nws_alert_lsr_matches'
    );
    console.log('');
    console.log('Table totals: nws_lsr_observations =', obsCount.rows[0]?.c ?? 0, ', nws_alert_lsr_matches =', matchCount.rows[0]?.c ?? 0);
  } catch (e) {
    console.log('DB summary skipped:', e.message);
  }

  await closePool();
  console.log('\nDone. LSR enrichment is working if lsr_products_fetched > 0, observations upserted > 0, and warnings show lsr_match_count > 0 when they have nearby LSRs.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
