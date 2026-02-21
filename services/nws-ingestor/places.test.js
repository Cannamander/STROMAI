'use strict';
/**
 * Places v1: tokenizeAreaDesc, getStatePlaces, LSR grouping and confidence.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert');
const { tokenizeAreaDesc, normalizePlaceKey, getStatePlaces } = require('./db');

describe('tokenizeAreaDesc', () => {
  it('splits on semicolon and trims', () => {
    const tokens = tokenizeAreaDesc('County A; County B; TX');
    assert.deepStrictEqual(tokens, ['County A', 'County B', 'TX']);
  });

  it('dedupes while preserving order', () => {
    const tokens = tokenizeAreaDesc('A; B; A; C');
    assert.deepStrictEqual(tokens, ['A', 'B', 'C']);
  });

  it('returns empty array for null or empty', () => {
    assert.deepStrictEqual(tokenizeAreaDesc(null), []);
    assert.deepStrictEqual(tokenizeAreaDesc(''), []);
    assert.deepStrictEqual(tokenizeAreaDesc('   ;   '), []);
  });
});

describe('normalizePlaceKey', () => {
  it('trims and collapses whitespace and uppercases', () => {
    assert.strictEqual(normalizePlaceKey('  Dallas   TX  '), 'DALLAS TX');
  });

  it('drops trailing COUNTY', () => {
    assert.strictEqual(normalizePlaceKey('Smith COUNTY'), 'SMITH');
  });

  it('returns empty string for null', () => {
    assert.strictEqual(normalizePlaceKey(null), '');
  });
});

describe('getStatePlaces', () => {
  it('returns lsr_places and area_desc_tokens', async () => {
    const data = await getStatePlaces('TX');
    assert(Array.isArray(data.lsr_places));
    assert(Array.isArray(data.area_desc_tokens));
  });

  it('lsr_places items have place, obs_count, confidence', async () => {
    const data = await getStatePlaces('TX');
    for (const p of data.lsr_places) {
      assert('place' in p);
      assert(typeof p.obs_count === 'number');
      assert(p.confidence === 'HIGH' || p.confidence === 'MEDIUM');
    }
  });

  it('area_desc_tokens items have token and alert_count', async () => {
    const data = await getStatePlaces('TX');
    for (const t of data.area_desc_tokens) {
      assert('token' in t);
      assert(typeof t.alert_count === 'number');
    }
  });

  it('returns empty arrays for empty state', async () => {
    const data = await getStatePlaces('');
    assert.deepStrictEqual(data.lsr_places, []);
    assert.deepStrictEqual(data.area_desc_tokens, []);
  });
});
