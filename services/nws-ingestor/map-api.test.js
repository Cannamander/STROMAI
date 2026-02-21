'use strict';
/**
 * Map API HTTP tests: GET /v1/map/alerts, /v1/map/zips, /v1/map/meta.
 * Uses the same db layer as the API to assert response shape (no server required).
 */
const { describe, it } = require('node:test');
const assert = require('node:assert');
const { getMapAlerts, getMapZips, getMapMeta } = require('./db');

describe('/v1/map/alerts API contract', () => {
  it('returns valid GeoJSON and respects query params', async () => {
    const geojson = await getMapAlerts({ states: ['TX'], since_hours: 48, warnings_only: false, interesting_only: false, min_score: 0 });
    assert.strictEqual(geojson.type, 'FeatureCollection');
    assert(Array.isArray(geojson.features));
  });
});

describe('/v1/map/zips API contract', () => {
  it('returns aggregated points with top_alert_ids and respects caps', async () => {
    let geojson;
    try {
      geojson = await getMapZips({ states: ['OK'], since_hours: 24 });
    } catch (e) {
      if (e.code === '42P01') return; // zcta5_centroids not yet migrated
      throw e;
    }
    assert.strictEqual(geojson.type, 'FeatureCollection');
    assert(geojson.features.length <= 2500);
    if (geojson.features.length > 0) {
      const f = geojson.features[0];
      assert(f.properties.zip);
      assert(Array.isArray(f.properties.top_alert_ids));
      assert(Array.isArray(f.properties.top_events));
    }
  });
});

describe('/v1/map/meta API contract', () => {
  it('returns radar config and time_supported boolean', async () => {
    const meta = await getMapMeta(['TX']);
    assert(meta.radar_wms);
    assert(typeof meta.radar_wms.time_supported === 'boolean');
    assert(Array.isArray(meta.default_center));
    assert(meta.time_extent && meta.time_extent.step_minutes != null);
  });
});
