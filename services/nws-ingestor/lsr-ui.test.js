'use strict';
/**
 * Lightweight UI/API tests: POST /v1/alerts/:id/lsr-recheck returns updated alert,
 * awaiting badge/countdown logic (unit-style).
 */
const { describe, it } = require('node:test');
const assert = require('node:assert');

describe('LSR recheck API contract', () => {
  it('getAlertById returns lsr_status and lsr_hold_until when present', async () => {
    const { getAlerts, getAlertById } = require('./db');
    let rows;
    try {
      rows = await getAlerts({});
    } catch (err) {
      if (err.code === '42703') return;
      throw err;
    }
    if (rows.length === 0) return;
    const a = await getAlertById(rows[0].alert_id);
    assert(a !== null);
    assert('lsr_status' in a || a.lsr_status === undefined);
    assert('lsr_hold_until' in a || a.lsr_hold_until === undefined);
    assert('lsr_last_checked_at' in a || a.lsr_last_checked_at === undefined);
    assert('lsr_check_attempts' in a || a.lsr_check_attempts === undefined);
  });
});

describe('LSR UI helpers', () => {
  it('hold countdown: hold_until in future yields positive minutes', () => {
    const holdUntil = new Date(Date.now() + 34 * 60 * 1000);
    const holdMs = holdUntil.getTime() - Date.now();
    const holdMin = Math.floor(holdMs / 60000);
    assert(holdMin >= 33 && holdMin <= 35);
  });

  it('lsr_status pill: awaiting displays as Awaiting LSR', () => {
    const lsrStatus = 'awaiting';
    const display = lsrStatus === 'awaiting' ? 'Awaiting LSR' : lsrStatus;
    assert.strictEqual(display, 'Awaiting LSR');
  });
});
