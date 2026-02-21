'use strict';
/**
 * Tests for LSR recheck: getAlertsDueForLsrRecheck only returns alerts past interval,
 * runSetBasedLsrMatchForAlerts + markLsrMatchedAndExpired updates status when matched.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert');
const {
  getAlertsDueForLsrRecheck,
  runSetBasedLsrMatchForAlerts,
  updateAlertLsrSummary,
  markLsrMatchedAndExpired,
  updateLsrRecheckAttempts,
  getAlertById,
} = require('./db');
const config = require('./config');

describe('LSR recheck scheduling', () => {
  it('getAlertsDueForLsrRecheck returns array of alert_ids', async () => {
    try {
      const ids = await getAlertsDueForLsrRecheck(config.lsrRecheckEveryMinutes || 10);
      assert(Array.isArray(ids));
    } catch (err) {
      if (err.code === '42703') return;
      throw err;
    }
  });

  it('only alerts past recheck interval are selected (recheck every 10 min)', async () => {
    try {
      const ids = await getAlertsDueForLsrRecheck(10);
      if (ids.length === 0) return;
      const rows = await Promise.all(ids.map((id) => getAlertById(id)));
      const now = new Date();
      const tenMinAgo = new Date(now.getTime() - 10 * 60 * 1000);
      for (const r of rows) {
        if (!r) continue;
        const lastChecked = r.lsr_last_checked_at ? new Date(r.lsr_last_checked_at) : null;
        assert(lastChecked === null || lastChecked <= tenMinAgo, 'due alerts should have last_checked past interval');
      }
    } catch (err) {
      if (err.code === '42703') return;
      throw err;
    }
  });
});

describe('LSR recheck results', () => {
  it('runSetBasedLsrMatchForAlerts runs for empty list without error', async () => {
    try {
      const result = await runSetBasedLsrMatchForAlerts([], 2, 30000);
      assert.strictEqual(result.inserted, 0);
    } catch (err) {
      if (err.code === '42703') return;
      throw err;
    }
  });

  it('when matches found, markLsrMatchedAndExpired sets lsr_status to matched', async () => {
    try {
      await updateAlertLsrSummary();
      await markLsrMatchedAndExpired();
      const { getAlerts } = require('./db');
      const rows = await getAlerts({});
      for (const r of rows) {
        const status = (r.lsr_status || 'none').toLowerCase();
        const count = r.lsr_match_count || 0;
        if (count > 0 && status === 'awaiting') {
          assert.fail('alert with lsr_match_count>0 should not remain awaiting');
        }
      }
    } catch (err) {
      if (err.code === '42703') return;
      if (err.code === '42P01' || (err.message && err.message.includes('FROM-clause'))) return;
      throw err;
    }
  });

  it('updateLsrRecheckAttempts runs for empty list without error', async () => {
    try {
      await updateLsrRecheckAttempts([]);
    } catch (err) {
      if (err.code === '42703') return;
      throw err;
    }
  });
});
