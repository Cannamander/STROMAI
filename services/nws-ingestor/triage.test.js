'use strict';
/**
 * Unit tests for computeTriage() and actionToStatus().
 */
const { describe, it } = require('node:test');
const assert = require('node:assert');
const { computeTriage, actionToStatus, TRIAGE_ACTIONS } = require('./triage');

describe('computeTriage', () => {
  it('warning + interesting_any => actionable, reasons include threshold', () => {
    const r = computeTriage({
      alert_class: 'warning',
      interesting_any: true,
      geom_present: true,
      lsr_match_count: 2,
      interesting_hail: true,
      interesting_wind: false,
      hail_max_inches: 1.75,
      wind_max_mph: null,
    });
    assert.strictEqual(r.status, 'actionable');
    assert(Array.isArray(r.reasons));
    assert(r.reasons.some((s) => s.includes('Warning')));
    assert(r.reasons.some((s) => s.includes('1.75')));
    assert(r.reasons.some((s) => s.includes('LSR matches')));
  });

  it('warning + interesting_any => confidence high when geom + LSR + interesting', () => {
    const r = computeTriage({
      alert_class: 'warning',
      interesting_any: true,
      geom_present: true,
      lsr_match_count: 3,
    });
    assert.strictEqual(r.status, 'actionable');
    assert.strictEqual(r.confidence_level, 'high');
  });

  it('warning + geom_present but no LSR/threshold => monitoring, includes Awaiting LSR', () => {
    const r = computeTriage({
      alert_class: 'warning',
      interesting_any: false,
      geom_present: true,
      lsr_match_count: 0,
    });
    assert.strictEqual(r.status, 'monitoring');
    assert(r.reasons.some((s) => s.includes('Awaiting LSR confirmation')));
  });

  it('watch => monitoring regardless of score', () => {
    const r = computeTriage({
      alert_class: 'watch',
      interesting_any: true,
      geom_present: true,
      lsr_match_count: 5,
    });
    assert.strictEqual(r.status, 'monitoring');
    assert(r.reasons.some((s) => s.includes('Watch')));
  });

  it('advisory/statement/other => monitoring', () => {
    assert.strictEqual(computeTriage({ alert_class: 'advisory' }).status, 'monitoring');
    assert.strictEqual(computeTriage({ alert_class: 'statement' }).status, 'monitoring');
    assert.strictEqual(computeTriage({ alert_class: 'other' }).status, 'monitoring');
  });

  it('null or invalid alert => new, low confidence', () => {
    assert.deepStrictEqual(computeTriage(null), { status: 'new', reasons: [], confidence_level: 'low' });
    assert.deepStrictEqual(computeTriage(undefined), { status: 'new', reasons: [], confidence_level: 'low' });
    // Empty object: alert_class becomes 'other' => monitoring
    assert.strictEqual(computeTriage({}).status, 'monitoring');
  });

  it('confidence: medium when geom and interesting or LSR', () => {
    const r = computeTriage({
      alert_class: 'warning',
      interesting_any: true,
      geom_present: true,
      lsr_match_count: 0,
    });
    assert.strictEqual(r.confidence_level, 'medium');
  });

  it('confidence: low when no geom and no LSR', () => {
    const r = computeTriage({
      alert_class: 'warning',
      interesting_any: false,
      geom_present: false,
      lsr_match_count: 0,
    });
    assert.strictEqual(r.confidence_level, 'low');
  });
});

describe('actionToStatus', () => {
  it('maps set_actionable to actionable', () => {
    assert.strictEqual(actionToStatus('set_actionable'), 'actionable');
  });
  it('maps set_monitoring to monitoring', () => {
    assert.strictEqual(actionToStatus('set_monitoring'), 'monitoring');
  });
  it('maps set_suppressed to suppressed', () => {
    assert.strictEqual(actionToStatus('set_suppressed'), 'suppressed');
  });
  it('maps set_sent_manual to sent_manual', () => {
    assert.strictEqual(actionToStatus('set_sent_manual'), 'sent_manual');
  });
  it('reset_to_system returns null', () => {
    assert.strictEqual(actionToStatus('reset_to_system'), null);
  });
  it('invalid action returns null', () => {
    assert.strictEqual(actionToStatus('invalid'), null);
  });
});
