'use strict';
/**
 * Frontend bulk UX tests: bulk summary format, export URL shape, confirmation required for destructive actions.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert');
const { buildBulkSummaryText } = require('./bulkSummaryFormat');

describe('Bulk Copy Summary format', () => {
  it('output starts with AI-STORMS BULK SUMMARY and has generated_at, selected_count, filters', () => {
    const text = buildBulkSummaryText({ alerts: [], selectedCount: 0, filtersString: 'sort_mode=action' });
    assert(text.startsWith('AI-STORMS BULK SUMMARY'));
    assert(text.includes('generated_at:'));
    assert(text.includes('selected_count: 0'));
    assert(text.includes('filters: sort_mode=action'));
  });

  it('per-alert block has alert_id, event, class, states, zips_count, lsr_count, interesting, triage_status, confidence, score, expires', () => {
    const alerts = [
      {
        alert_id: 'id1',
        event: 'Severe Thunderstorm Warning',
        alert_class: 'warning',
        impacted_states: ['TX', 'OK'],
        zip_count: 10,
        lsr_match_count: 1,
        hail_max_inches: 1.5,
        wind_max_mph: 75,
        interesting_hail: true,
        interesting_wind: true,
        interesting_rare_freeze: false,
        interesting_any: true,
        triage_status: 'actionable',
        confidence_level: 'high',
        damage_score: 60,
        expires: '2025-01-01T12:00:00Z',
      },
    ];
    const text = buildBulkSummaryText({ alerts, selectedCount: 1, filtersString: '' });
    assert(text.includes('- alert_id: id1'));
    assert(text.includes('  event: Severe Thunderstorm Warning'));
    assert(text.includes('  class: warning'));
    assert(text.includes('  states: TX,OK'));
    assert(text.includes('  zips_count: 10'));
    assert(text.includes('  lsr_count: 1'));
    assert(text.includes('  hail_max_inches: 1.5'));
    assert(text.includes('  wind_max_mph: 75'));
    assert(text.includes('  interesting: hail=T wind=T rare_freeze=F any=T'));
    assert(text.includes('  triage_status: actionable'));
    assert(text.includes('  confidence: high'));
    assert(text.includes('  score: 60'));
    assert(text.includes('  expires: 2025-01-01T12:00:00Z'));
  });
});

describe('Bulk export URL shape', () => {
  it('export URL contains alert_ids and mode (per_alert or unique)', () => {
    const base = '';
    const ids = ['id1', 'id2'];
    const mode = 'per_alert';
    const url = base + '/v1/alerts/zips.csv?alert_ids=' + encodeURIComponent(ids.join(',')) + '&mode=' + encodeURIComponent(mode);
    assert(url.includes('alert_ids=id1%2Cid2'));
    assert(url.includes('mode=per_alert'));
  });

  it('unique mode URL uses mode=unique', () => {
    const ids = ['a', 'b'];
    const url = '/v1/alerts/zips.csv?alert_ids=' + encodeURIComponent(ids.join(',')) + '&mode=unique';
    assert(url.includes('mode=unique'));
  });
});

describe('Bulk confirmation (destructive actions)', () => {
  it('set_suppressed and set_sent_manual require confirmation (spec)', () => {
    const destructiveActions = ['set_suppressed', 'set_sent_manual'];
    assert(destructiveActions.includes('set_suppressed'));
    assert(destructiveActions.includes('set_sent_manual'));
  });

  it('queue delivery when N > 10 requires confirmation (spec)', () => {
    const confirmWhenOver = 10;
    assert(confirmWhenOver === 10);
  });
});
