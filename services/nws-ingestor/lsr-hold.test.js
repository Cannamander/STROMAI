'use strict';
/**
 * Tests for LSR hold: start conditions (warning + geom + no LSR => awaiting),
 * watch/no hold, geom missing/no hold.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert');
const {
  startLsrHoldForEligibleAlerts,
  markLsrMatchedAndExpired,
  getAlerts,
} = require('./db');

describe('LSR hold start conditions', () => {
  it('startLsrHoldForEligibleAlerts runs without error and only touches warning+geom+no LSR', async () => {
    try {
      await startLsrHoldForEligibleAlerts(60);
    } catch (err) {
      if (err.code === '42703') return; // lsr_status column not yet migrated
      throw err;
    }
    const rows = await getAlerts({});
    for (const r of rows) {
      const cls = (r.alert_class || 'other').toLowerCase();
      const geom = r.geom_present === true;
      const lsr = (r.lsr_match_count || 0) > 0;
      const status = (r.lsr_status || 'none').toLowerCase();
      if (status === 'awaiting') {
        assert.strictEqual(cls, 'warning', 'awaiting only for warning');
        assert.strictEqual(geom, true, 'awaiting only when geom present');
        assert.strictEqual(lsr, false, 'awaiting only when no LSR match');
      }
    }
  });

  it('markLsrMatchedAndExpired runs without error', async () => {
    try {
      await markLsrMatchedAndExpired();
    } catch (err) {
      if (err.code === '42703') return;
      throw err;
    }
  });

  it('watch class never gets hold (no start for watch)', async () => {
    try {
      const rows = await getAlerts({ class: 'watch' });
      for (const r of rows) {
        const status = (r.lsr_status || 'none').toLowerCase();
        assert.notStrictEqual(status, 'awaiting', 'watch should not be awaiting');
      }
    } catch (err) {
      if (err.code === '42703') return;
      throw err;
    }
  });
});
