'use strict';
/**
 * Tests for operator console sorting and filtering: preset sort modes, column sort override, state filter.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert');
const { buildAlertsOrderBy, SORT_COLUMNS, getAlerts } = require('./db');

describe('buildAlertsOrderBy preset mapping', () => {
  it('sort_mode=action produces Action Priority ORDER BY', () => {
    const orderBy = buildAlertsOrderBy({ sort_mode: 'action' });
    assert.ok(orderBy.includes('interesting_any'), 'action: interesting_any');
    assert.ok(orderBy.includes('damage_score'));
    assert.ok(orderBy.includes('lsr_match_count'));
    assert.ok(orderBy.includes('expires ASC'));
  });

  it('sort_mode=damage produces Confirmed Damage ORDER BY', () => {
    const orderBy = buildAlertsOrderBy({ sort_mode: 'damage' });
    assert.ok(orderBy.includes('lsr_match_count'));
    assert.ok(orderBy.includes('hail_max_inches'));
    assert.ok(orderBy.includes('wind_max_mph'));
    assert.ok(orderBy.includes('damage_score'));
  });

  it('sort_mode=tight produces Tight Impact ORDER BY', () => {
    const orderBy = buildAlertsOrderBy({ sort_mode: 'tight' });
    assert.ok(orderBy.includes('zip_density DESC'));
    assert.ok(orderBy.includes('area_sq_miles ASC'));
  });

  it('sort_mode=expires produces Expiring Soon ORDER BY', () => {
    const orderBy = buildAlertsOrderBy({ sort_mode: 'expires' });
    assert.ok(orderBy.includes('expires ASC'));
    assert.ok(orderBy.includes('damage_score'));
  });

  it('sort_mode=broad produces Broad Systems ORDER BY', () => {
    const orderBy = buildAlertsOrderBy({ sort_mode: 'broad' });
    assert.ok(orderBy.includes('area_sq_miles DESC'));
    assert.ok(orderBy.includes('zip_count'));
  });

  it('default (no sort_mode) is action', () => {
    const orderBy = buildAlertsOrderBy({});
    assert.ok(orderBy.includes('interesting_any'));
  });
});

describe('buildAlertsOrderBy column sort override', () => {
  it('sort_by=damage_score&sort_dir=desc produces correct ORDER BY', () => {
    const orderBy = buildAlertsOrderBy({ sort_by: 'damage_score', sort_dir: 'desc' });
    assert.ok(orderBy.includes('damage_score'));
    assert.ok(orderBy.includes('DESC'));
  });

  it('sort_by=expires&sort_dir=asc produces expires ASC', () => {
    const orderBy = buildAlertsOrderBy({ sort_by: 'expires', sort_dir: 'asc' });
    assert.ok(orderBy.includes('expires'));
    assert.ok(orderBy.includes('ASC'));
  });

  it('rejects invalid sort_by (falls back to preset)', () => {
    const orderBy = buildAlertsOrderBy({ sort_by: 'invalid_column', sort_dir: 'desc' });
    assert.ok(orderBy.includes('interesting_any'), 'falls back to action preset');
  });

  it('whitelist includes required columns', () => {
    assert.ok(SORT_COLUMNS.has('event'));
    assert.ok(SORT_COLUMNS.has('zip_count'));
    assert.ok(SORT_COLUMNS.has('area_sq_miles'));
    assert.ok(SORT_COLUMNS.has('zip_density'));
    assert.ok(SORT_COLUMNS.has('lsr_match_count'));
    assert.ok(SORT_COLUMNS.has('damage_score'));
    assert.ok(SORT_COLUMNS.has('expires'));
  });
});

describe('state filter', () => {
  it('state=MD returns only alerts where MD in impacted_states', async () => {
    const rows = await getAlerts({ state: 'MD' });
    for (const r of rows) {
      const states = Array.isArray(r.impacted_states) ? r.impacted_states : [];
      assert.ok(states.includes('MD'), 'each row must have MD in impacted_states');
    }
  });
});
