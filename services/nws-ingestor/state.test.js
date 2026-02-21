'use strict';
/**
 * State drilldown: summary, state-scoped alerts, outbox by state.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert');
const { getStateSummary, getAlerts, getOutboxByState } = require('./db');

describe('getStateSummary', () => {
  it('returns counts and top_events/top_alerts for a state', async () => {
    const summary = await getStateSummary('TX');
    assert(summary != null);
    assert(typeof summary.counts === 'object');
    assert(Number.isInteger(summary.counts.active_alerts));
    assert(Number.isInteger(summary.counts.warnings));
    assert(Number.isInteger(summary.counts.interesting));
    assert(Number.isInteger(summary.counts.lsr_total));
    assert(Array.isArray(summary.top_events));
    assert(Array.isArray(summary.top_alerts));
    assert(summary.updated_at);
  });

  it('returns empty structure for invalid state', async () => {
    const summary = await getStateSummary('');
    assert(summary.counts);
    assert(Array.isArray(summary.top_events));
    assert(summary.top_events.length === 0);
  });
});

describe('state-scoped alerts', () => {
  it('getAlerts with state returns only alerts containing that state', async () => {
    const rows = await getAlerts({ state: 'TX' });
    for (const r of rows) {
      const states = Array.isArray(r.impacted_states) ? r.impacted_states : [];
      assert(states.includes('TX'), 'each row must have TX in impacted_states');
    }
  });
});

describe('getOutboxByState', () => {
  it('returns array of outbox rows', async () => {
    const rows = await getOutboxByState('TX', 10);
    assert(Array.isArray(rows));
  });
});
