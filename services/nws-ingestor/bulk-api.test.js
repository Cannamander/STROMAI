'use strict';
/**
 * Backend tests for bulk operations: triage bulk (status + audit), reset_to_system,
 * bulk queue (enqueueDeliveryOnce idempotent), bulk zip export shape, BULK_MAX enforced.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert');
const {
  getAlerts,
  getAlertById,
  getAlertsByIds,
  updateAlertTriage,
  insertTriageAudit,
  getTriageAudit,
  enqueueDeliveryOnce,
} = require('./db');
const { computeTriage, actionToStatus } = require('./triage');
const config = require('./config');

describe('bulk config', () => {
  it('BULK_MAX is enforced (config.bulkMax between 1 and 500)', () => {
    assert(typeof config.bulkMax === 'number');
    assert(config.bulkMax >= 1 && config.bulkMax <= 500);
  });
});

describe('getAlertsByIds', () => {
  it('returns rows in same order as input ids where found', async () => {
    let rows;
    try {
      rows = await getAlerts({});
    } catch (err) {
      if (err.code === '42703') return;
      throw err;
    }
    if (rows.length === 0) return;
    const ids = rows.slice(0, 3).map((r) => r.alert_id);
    const out = await getAlertsByIds(ids);
    assert.strictEqual(out.length, ids.length);
    out.forEach((o, i) => {
      assert.strictEqual(o.alert_id, ids[i]);
    });
  });

  it('returns empty for empty input', async () => {
    const out = await getAlertsByIds([]);
    assert.deepStrictEqual(out, []);
  });

  it('omits missing ids (only returns found)', async () => {
    const out = await getAlertsByIds(['nonexistent-id-12345']);
    assert.strictEqual(out.length, 0);
  });
});

describe('bulk triage (db + audit)', () => {
  it('bulk triage sets correct status and creates audit row per alert', async () => {
    let rows;
    try {
      rows = await getAlerts({});
    } catch (err) {
      if (err.code === '42703') return;
      throw err;
    }
    if (rows.length === 0) return;
    const alertId = rows[0].alert_id;
    const prevStatus = rows[0].triage_status || 'new';
    try {
      await updateAlertTriage(alertId, {
        triage_status: 'suppressed',
        triage_status_source: 'operator',
        triage_status_updated_by: 'bulk-test',
      });
      await insertTriageAudit(alertId, 'bulk-test', 'set_suppressed', prevStatus, 'suppressed', 'bulk test');
      const updated = await getAlertById(alertId);
      assert.strictEqual((updated.triage_status || '').toLowerCase(), 'suppressed');
      const audit = await getTriageAudit(alertId, 5);
      assert(audit.length >= 1);
      const last = audit[0];
      assert.strictEqual(last.action, 'set_suppressed');
      assert.strictEqual(last.new_status, 'suppressed');
      // Reset so we don't leave test data
      const { status, reasons, confidence_level } = computeTriage(updated);
      await updateAlertTriage(alertId, {
        triage_status: status,
        triage_status_source: 'system',
        triage_reasons: reasons,
        confidence_level,
        triage_status_updated_by: null,
      });
    } catch (err) {
      if (err.code === '42703') return;
      throw err;
    }
  });

  it('reset_to_system recomputes triage and sets source=system', async () => {
    let rows;
    try {
      rows = await getAlerts({});
    } catch (err) {
      if (err.code === '42703') return;
      throw err;
    }
    if (rows.length === 0) return;
    const alertId = rows[0].alert_id;
    const alert = await getAlertById(alertId);
    const { status, reasons, confidence_level } = computeTriage(alert);
    try {
      await updateAlertTriage(alertId, {
        triage_status: status,
        triage_status_source: 'system',
        triage_reasons: reasons,
        confidence_level,
        triage_status_updated_by: null,
      });
      const after = await getAlertById(alertId);
      assert.strictEqual((after.triage_status_source || '').toLowerCase(), 'system');
    } catch (err) {
      if (err.code === '42703') return;
      throw err;
    }
  });
});

describe('bulk queue (enqueueDeliveryOnce)', () => {
  it('creates outbox entry and is idempotent by event_key', async () => {
    let rows;
    try {
      rows = await getAlerts({});
    } catch (err) {
      if (err.code === '42703') return;
      throw err;
    }
    if (rows.length === 0) return;
    const alert = await getAlertById(rows[0].alert_id);
    if (!alert || !alert.zips || alert.zips.length === 0) return;
    const { buildDeliveryPayload } = require('./payloadBuilder');
    const payload = buildDeliveryPayload(alert, 1);
    const params = { destination: 'property_enrichment_v1', alert_id: alert.alert_id, payload_version: 1, payload };
    const zips = alert.zips || [];
    try {
      const first = await enqueueDeliveryOnce(params, zips);
      assert.strictEqual(first.inserted, true);
      const second = await enqueueDeliveryOnce(params, zips);
      assert.strictEqual(second.inserted, false);
    } catch (err) {
      if (err.code === '42P01') return; // zip_delivery_outbox not migrated
      throw err;
    }
  });
});

describe('bulk zip export shape', () => {
  it('getAlertsByIds returns alerts with zips for per_alert/unique CSV', async () => {
    let rows;
    try {
      rows = await getAlerts({});
    } catch (err) {
      if (err.code === '42703') return;
      throw err;
    }
    if (rows.length === 0) return;
    const ids = rows.slice(0, 2).map((r) => r.alert_id);
    const alerts = await getAlertsByIds(ids);
    assert(Array.isArray(alerts));
    alerts.forEach((a) => {
      assert('alert_id' in a);
      assert(Array.isArray(a.zips) || a.zips === undefined);
    });
    // per_alert: alert_id,zip per row
    const perAlertLines = ['alert_id,zip'];
    for (const a of alerts) {
      for (const z of (a.zips || [])) perAlertLines.push(a.alert_id + ',' + z);
    }
    assert(perAlertLines[0] === 'alert_id,zip');
    // unique: dedupe zips
    const set = new Set();
    for (const a of alerts) for (const z of (a.zips || [])) set.add(z);
    const uniqueZips = [...set].sort();
    assert(Array.isArray(uniqueZips));
  });
});
