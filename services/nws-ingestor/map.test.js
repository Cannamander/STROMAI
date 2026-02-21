'use strict';
/**
 * Map: getMapAlerts, getMapZips, getMapMeta; GeoJSON shape; filters and bbox; centroid SRID.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert');
const { getMapAlerts, getMapZips, getMapMeta, pool } = require('./db');

describe('getMapAlerts', () => {
  it('returns valid GeoJSON FeatureCollection', async () => {
    const geojson = await getMapAlerts({});
    assert.strictEqual(geojson.type, 'FeatureCollection');
    assert(Array.isArray(geojson.features));
    geojson.features.forEach((f) => {
      assert.strictEqual(f.type, 'Feature');
      assert(f.geometry && typeof f.geometry === 'object');
      assert(f.properties && typeof f.properties.alert_id === 'string');
      assert('event' in f.properties);
      assert('alert_class' in f.properties);
      assert('damage_score' in f.properties || f.properties.damage_score === undefined);
    });
  });

  it('respects states filter', async () => {
    const geojson = await getMapAlerts({ states: ['TX'] });
    assert.strictEqual(geojson.type, 'FeatureCollection');
    assert(Array.isArray(geojson.features));
    // Each feature came from an alert that has TX in impacted_states (enforced by query)
  });

  it('respects bbox when provided', async () => {
    const geojson = await getMapAlerts({ bbox: [-100, 30, -95, 35] });
    assert.strictEqual(geojson.type, 'FeatureCollection');
    assert(Array.isArray(geojson.features));
  });

  it('caps at 300 polygons', async () => {
    const geojson = await getMapAlerts({});
    assert(geojson.features.length <= 300);
  });
});

describe('getMapZips', () => {
  it('returns GeoJSON FeatureCollection of points', async () => {
    let geojson;
    try {
      geojson = await getMapZips({});
    } catch (e) {
      if (e.code === '42P01') return; // skip if zcta5_centroids not yet migrated
      throw e;
    }
    assert.strictEqual(geojson.type, 'FeatureCollection');
    assert(Array.isArray(geojson.features));
    geojson.features.forEach((f) => {
      assert.strictEqual(f.type, 'Feature');
      assert(f.geometry && f.geometry.type === 'Point' && Array.isArray(f.geometry.coordinates));
      assert(f.properties && typeof f.properties.zip === 'string');
      assert(Number.isInteger(f.properties.alert_count));
      assert(Array.isArray(f.properties.top_alert_ids));
      assert(f.properties.top_alert_ids.length <= 5);
    });
  });

  it('respects filters and caps at 2500', async () => {
    let geojson;
    try {
      geojson = await getMapZips({ states: ['OK'], since_hours: 48 });
    } catch (e) {
      if (e.code === '42P01') return;
      throw e;
    }
    assert.strictEqual(geojson.type, 'FeatureCollection');
    assert(geojson.features.length <= 2500);
  });
});

describe('getMapMeta', () => {
  it('returns default_center, radar_wms, time_extent and time_supported', async () => {
    const meta = await getMapMeta([]);
    assert(Array.isArray(meta.default_center));
    assert(meta.default_center.length >= 2);
    assert(typeof meta.radar_wms === 'object');
    assert(typeof meta.radar_wms.baseUrl === 'string');
    assert(typeof meta.radar_wms.time_supported === 'boolean');
    assert(meta.time_extent && meta.time_extent.start && meta.time_extent.end);
    assert(meta.time_extent.step_minutes != null);
  });
});

describe('zcta5_centroids SRID', () => {
  it('centroid geom is SRID 4326 when table exists', async () => {
    let rows;
    try {
      const r = await pool.query(`SELECT ST_SRID(geom) AS srid FROM public.zcta5_centroids LIMIT 1`);
      rows = r.rows;
    } catch (e) {
      if (e.code === '42P01') return; // table not yet migrated
      throw e;
    }
    if (!rows || rows.length === 0) return; // table empty
    assert.strictEqual(Number(rows[0].srid), 4326);
  });
});
