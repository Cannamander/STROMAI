#!/usr/bin/env node
'use strict';
/**
 * Test LSR enrichment: fetch recent LSR products, parse, and report counts.
 * Optionally run match against one alert from DB (if any) to verify point-in-polygon + insert.
 *
 * Usage: npm run nws:test-lsr   or   node services/nws-ingestor/scripts/test-lsr-enrichment.js
 * Requires: .env with DATABASE_URL (only for optional DB step). NWS fetch uses NWS_BASE_URL, NWS_USER_AGENT.
 */
require('dotenv').config();
const config = require('../config');
const { fetchRecentLsrProducts } = require('../lsrClient');
const { parseLsrProduct } = require('../lsrParser');
const { pool, lsrPointInAlertGeometry, insertLsrMatch, closePool } = require('../db');

async function main() {
  console.log('LSR enrichment test (fetch + parse)\n');
  console.log('Lookback hours:', config.lsrLookbackHours);

  let products = [];
  try {
    products = await fetchRecentLsrProducts();
    console.log('Products fetched:', products.length);
  } catch (e) {
    console.error('Fetch failed:', e.message);
    process.exit(1);
  }

  let totalEntries = 0;
  let withPoints = 0;
  let withHail = 0;
  let withWind = 0;
  const samples = [];

  for (const p of products) {
    const entries = parseLsrProduct(p.productText, p.productId, p.issuanceTime);
    totalEntries += entries.length;
    for (const e of entries) {
      if (e.lat != null && e.lon != null) withPoints++;
      if (e.hail_in != null) withHail++;
      if (e.wind_gust_mph != null) withWind++;
      if (samples.length < 5 && (e.hail_in != null || e.wind_gust_mph != null)) {
        samples.push({ ...e, productId: p.productId });
      }
    }
  }

  console.log('Entries parsed (hail or wind):', totalEntries);
  console.log('Entries with lat/lon:', withPoints);
  console.log('Entries with hail_in:', withHail);
  console.log('Entries with wind_gust_mph:', withWind);

  if (samples.length > 0) {
    console.log('\nSample entries:');
    samples.forEach((s, i) => {
      console.log(
        `  ${i + 1}. hail=${s.hail_in ?? '-'} in, wind=${s.wind_gust_mph ?? '-'} mph, lat=${s.lat ?? '-'}, lon=${s.lon ?? '-'} | ${(s.raw_text || '').slice(0, 60)}...`
      );
    });
  }

  // Optional: try to match one alert from DB
  try {
    const alertsWithGeom = await pool.query(
      `SELECT id, geometry_json FROM public.nws_alerts WHERE geometry_json IS NOT NULL LIMIT 1`
    );
    if (alertsWithGeom.rows.length > 0) {
      const alert = alertsWithGeom.rows[0];
      let geom = alert.geometry_json;
      if (typeof geom === 'string') try { geom = JSON.parse(geom); } catch (_) { geom = null; }
      if (geom && typeof geom === 'object') {
        let matched = 0;
        for (const p of products) {
          const entries = parseLsrProduct(p.productText, p.productId, p.issuanceTime);
          for (const e of entries) {
            if (e.lat == null || e.lon == null) continue;
            const inside = await lsrPointInAlertGeometry(geom, e.lon, e.lat);
            if (inside) {
              const result = await insertLsrMatch({
                alert_id: alert.id,
                lsr_product_id: p.productId,
                entry_time: e.entry_time,
                lon: e.lon,
                lat: e.lat,
                hail_in: e.hail_in,
                wind_gust_mph: e.wind_gust_mph,
                raw_text: e.raw_text,
              });
              if (result === 'inserted') matched++;
            }
          }
        }
        console.log('\nDB check: 1 alert with geometry found. LSR entries matched and inserted:', matched);
      }
    } else {
      console.log('\nDB check: no alerts with geometry in nws_alerts (run nws:once when there are active alerts to test full flow).');
    }
  } catch (dbErr) {
    console.log('\nDB check skipped:', dbErr.message);
  }

  await closePool();
  console.log('\nDone. If you see products fetched > 0 and entries parsed > 0, enrichment fetch + parse is working.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
