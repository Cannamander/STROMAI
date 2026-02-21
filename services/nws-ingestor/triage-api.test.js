'use strict';
/**
 * API/DB tests for triage: filters, updateAlertTriage, insertTriageAudit, reset_to_system behavior.
 * Requires DB with alert_impacted_zips (and triage columns from migration 014).
 */
const { describe, it } = require('node:test');
const assert = require('node:assert');
const { getAlerts, getAlertById, updateAlertTriage, insertTriageAudit, buildAlertsOrderBy } = require('./db');
const { computeTriage } = require('./triage');

describe('triage API / DB', () => {
  it('getAlerts with triage_status filter returns only matching rows', async () => {
    let rows;
    try {
      rows = await getAlerts({ triage_status: 'actionable' });
    } catch (err) {
      if (err.code === '42703') return; // triage_status column not yet migrated
      throw err;
    }
    assert(Array.isArray(rows));
    rows.forEach((r) => {
      assert.strictEqual((r.triage_status || 'new').toLowerCase(), 'actionable');
    });
  });

  it('getAlerts with work_queue true filters actionable and monitoring', async () => {
    let rows;
    try {
      rows = await getAlerts({ work_queue: true });
    } catch (err) {
      if (err.code === '42703') return;
      throw err;
    }
    assert(Array.isArray(rows));
    rows.forEach((r) => {
      const s = (r.triage_status || 'new').toLowerCase();
      assert(s === 'actionable' || s === 'monitoring', 'work_queue should only return actionable or monitoring');
    });
  });

  it('buildAlertsOrderBy work_queue returns actionable-first order', () => {
    const orderBy = buildAlertsOrderBy({ sort_mode: 'work_queue' });
    assert(orderBy.includes('actionable'));
    assert(orderBy.includes('monitoring'));
    assert(orderBy.includes('triage_status'));
  });

  it('POST triage sets status and inserts audit (via db)', async () => {
    let rows;
    try {
      rows = await getAlerts({});
    } catch (err) {
      if (err.code === '42703') return;
      throw err;
    }
    if (rows.length === 0) return; // no alerts to test
    const alertId = rows[0].alert_id;
    const prevStatus = rows[0].triage_status || 'new';

    try {
      await updateAlertTriage(alertId, {
        triage_status: 'suppressed',
        triage_status_source: 'operator',
        triage_status_updated_by: 'test@test',
      });
      await insertTriageAudit(alertId, 'test@test', 'set_suppressed', prevStatus, 'suppressed', 'test note');

      const updated = await getAlertById(alertId);
      assert.strictEqual((updated.triage_status || '').toLowerCase(), 'suppressed');
      assert.strictEqual((updated.triage_status_source || '').toLowerCase(), 'operator');

      // Reset to system so we don't leave test data
      const { status, reasons, confidence_level } = computeTriage(updated);
      await updateAlertTriage(alertId, {
        triage_status: status,
        triage_status_source: 'system',
        triage_reasons: reasons,
        confidence_level,
        triage_status_updated_by: null,
      });
    } catch (err) {
      if (err.code === '42703') return; // skip if triage columns not migrated
      throw err;
    }
  });

  it('reset_to_system recomputes status and source', async () => {
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
      assert(Array.isArray(after.triage_reasons));
      assert(['low', 'medium', 'high'].includes((after.confidence_level || '').toLowerCase()));
    } catch (err) {
      if (err.code === '42703') return; // skip if triage columns not migrated
      throw err;
    }
  });
});
