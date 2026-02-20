'use strict';
const config = require('./config');
const { listLsrProductIds, fetchProduct } = require('./lsrClient');
const { parseLsrProduct, parseLsrProductToObservations } = require('./lsrParser');
const { lsrPointInAlertGeometry, insertLsrMatch, upsertLsrObservations, runSetBasedLsrMatch, updateAlertLsrSummary } = require('./db');
const log = require('./logger');

const LSR_FETCH_CONCURRENCY = Math.min(10, Math.max(5, parseInt(process.env.LSR_FETCH_CONCURRENCY, 10) || 8));

/**
 * For one actionable alert, match LSR entries (with lat/lon) to alert geometry and time window; insert matches.
 * @param {object} alert - Normalized alert: id, geometry_json, effective, expires
 * @param {Array<{ productId: string, issuanceTime: string|null, productText: string }>} products
 * @param {number} slopHours - LSR_TIME_SLOP_HOURS
 * @returns {Promise<{ entriesWithPoints: number, matchesInserted: number }>}
 */
async function enrichAlertWithLsr(alert, products, slopHours) {
  let entriesWithPoints = 0;
  let matchesInserted = 0;
  const alertGeom = alert.geometry_json;
  const effective = alert.effective ? new Date(alert.effective) : null;
  const expires = alert.expires ? new Date(alert.expires) : null;
  const windowStart = effective ? new Date(effective.getTime() - slopHours * 60 * 60 * 1000) : null;
  const windowEnd = expires ? new Date(expires.getTime() + slopHours * 60 * 60 * 1000) : null;

  if (!alertGeom || typeof alertGeom !== 'object') return { entriesWithPoints: 0, matchesInserted: 0 };

  for (const prod of products) {
    const entries = parseLsrProduct(prod.productText, prod.productId, prod.issuanceTime);
    for (const entry of entries) {
      if (entry.lat == null || entry.lon == null) continue;
      entriesWithPoints++;
      if (windowStart && entry.entry_time && new Date(entry.entry_time) < windowStart) continue;
      if (windowEnd && entry.entry_time && new Date(entry.entry_time) > windowEnd) continue;
      const inside = await lsrPointInAlertGeometry(alertGeom, entry.lon, entry.lat);
      if (!inside) continue;
      const result = await insertLsrMatch({
        alert_id: alert.id,
        lsr_product_id: prod.productId,
        entry_time: entry.entry_time,
        lon: entry.lon,
        lat: entry.lat,
        hail_in: entry.hail_in,
        wind_gust_mph: entry.wind_gust_mph,
        raw_text: entry.raw_text,
      });
      if (result === 'inserted') matchesInserted++;
    }
  }
  return { entriesWithPoints, matchesInserted };
}

/**
 * Fetch LSR products, parse all entries, then for each alert with geometry run enrichAlertWithLsr.
 * @param {object[]} actionableAlerts - Normalized alerts (with geometry_json, id, effective, expires)
 * @returns {Promise<{ lsr_products_fetched: number, lsr_entries_parsed: number, lsr_entries_with_points: number, lsr_matches_inserted: number }>}
 */
async function enrichWithLsr(actionableAlerts) {
  let lsr_products_fetched = 0;
  let lsr_entries_parsed = 0;
  let lsr_entries_with_points = 0;
  let lsr_matches_inserted = 0;

  let products = [];
  try {
    products = await fetchRecentLsrProducts();
    lsr_products_fetched = products.length;
  } catch (err) {
    log.errorMsg('LSR fetch failed: ' + (err && err.message));
    return { lsr_products_fetched: 0, lsr_entries_parsed: 0, lsr_entries_with_points: 0, lsr_matches_inserted: 0 };
  }

  for (const prod of products) {
    const entries = parseLsrProduct(prod.productText, prod.productId, prod.issuanceTime);
    lsr_entries_parsed += entries.length;
    for (const e of entries) {
      if (e.lat != null && e.lon != null) lsr_entries_with_points++;
    }
  }

  const slopHours = config.lsrTimeSlopHours;
  const alertsWithGeom = (actionableAlerts || []).filter((a) => a.geometry_json != null);

  const enrichResults = await Promise.all(
    alertsWithGeom.map(async (alert) => {
      try {
        return await enrichAlertWithLsr(alert, products, slopHours);
      } catch (err) {
        log.errorMsg('LSR enrich failed for alert ' + (alert && alert.id) + ': ' + (err && err.message));
        return { matchesInserted: 0 };
      }
    })
  );
  for (const result of enrichResults) {
    lsr_matches_inserted += result.matchesInserted;
  }

  return {
    lsr_products_fetched,
    lsr_entries_parsed,
    lsr_entries_with_points: lsr_entries_with_points,
    lsr_matches_inserted,
  };
}

/**
 * LSR pipeline: discover products (lookback), fetch with concurrency limit, parse to observations,
 * upsert nws_lsr_observations, run set-based match (warnings only), update alert LSR summaries.
 * @returns {Promise<{ lsr_products_fetched: number, lsr_observations_parsed: number, lsr_observations_upserted: number, lsr_matches_inserted: number }>}
 */
async function runLsrPipeline() {
  let lsr_products_fetched = 0;
  let lsr_observations_parsed = 0;
  let lsr_observations_upserted = 0;
  let lsr_matches_inserted = 0;

  let productIds = [];
  try {
    const list = await listLsrProductIds();
    productIds = list.map((p) => p.id).filter(Boolean);
  } catch (err) {
    log.errorMsg('LSR list failed: ' + (err && err.message));
    return { lsr_products_fetched: 0, lsr_observations_parsed: 0, lsr_observations_upserted: 0, lsr_matches_inserted: 0 };
  }

  const products = [];
  for (let i = 0; i < productIds.length; i += LSR_FETCH_CONCURRENCY) {
    const chunk = productIds.slice(i, i + LSR_FETCH_CONCURRENCY);
    const results = await Promise.all(
      chunk.map(async (id) => {
        try {
          const p = await fetchProduct(id);
          if (p && (p.productText || '').trim()) return p;
        } catch (_) {
          // skip
        }
        return null;
      })
    );
    products.push(...results.filter(Boolean));
  }
  lsr_products_fetched = products.length;

  const allObservations = [];
  for (const prod of products) {
    const issued = prod.issuanceTime || null;
    const wfo = null;
    const rows = parseLsrProductToObservations(prod.productText, prod.productId, issued, wfo);
    lsr_observations_parsed += rows.length;
    allObservations.push(...rows);
  }

  if (allObservations.length > 0) {
    lsr_observations_upserted = await upsertLsrObservations(allObservations);
    const bufferHours = config.alertLsrTimeBufferHours ?? 2;
    const distanceMeters = config.alertLsrDistanceMeters ?? 30000;
    const matchResult = await runSetBasedLsrMatch(bufferHours, distanceMeters);
    lsr_matches_inserted = matchResult.inserted ?? 0;
    await updateAlertLsrSummary();
  }

  return {
    lsr_products_fetched,
    lsr_observations_parsed,
    lsr_observations_upserted,
    lsr_matches_inserted,
  };
}

module.exports = { enrichAlertWithLsr, enrichWithLsr, runLsrPipeline };
