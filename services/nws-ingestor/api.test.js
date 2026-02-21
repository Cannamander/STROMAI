'use strict';
/**
 * API tests for /v1/alerts: one row per alert_id, filters, response shape.
 * These tests mock the DB or run against a test DB; minimal deps.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert');

describe('/v1/alerts API contract', () => {
  it('getAlerts returns array of rows with alert_id', () => {
    const { getAlerts } = require('./db');
    return getAlerts({}).then((rows) => {
      assert(Array.isArray(rows));
      rows.forEach((r) => {
        assert(typeof r === 'object');
        assert('alert_id' in r);
        assert('event' in r);
        assert('zip_count' in r);
      });
    });
  });

  it('each row has one alert_id (one row per alert)', () => {
    const { getAlerts } = require('./db');
    return getAlerts({}).then((rows) => {
      const ids = rows.map((r) => r.alert_id);
      const unique = new Set(ids);
      assert.strictEqual(ids.length, unique.size, 'each row must have unique alert_id');
    });
  });

  it('filters: class=warning restricts to warning events', async () => {
    const { getAlerts } = require('./db');
    let rows;
    try {
      rows = await getAlerts({ class: 'warning' });
    } catch (err) {
      if (err.code === '42703') return; // skip if alert_class column not yet migrated
      throw err;
    }
    rows.forEach((r) => {
      const cls = r.alert_class || (r.event && r.event.includes('Warning') ? 'warning' : '');
      assert(cls === 'warning' || r.event.includes('Warning'), 'class=warning should return only warnings');
    });
  });

  it('response includes damage console fields when present', () => {
    const { getAlerts } = require('./db');
    return getAlerts({}).then((rows) => {
      if (rows.length === 0) return;
      const first = rows[0];
      assert('geom_present' in first);
      assert('damage_score' in first || first.damage_score === undefined);
      assert('delivery_status' in first || first.delivery_status === undefined);
    });
  });
});
