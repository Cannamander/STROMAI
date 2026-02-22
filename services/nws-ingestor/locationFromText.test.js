'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert');
const { extractPlaceNames } = require('./locationFromText');

describe('extractPlaceNames', () => {
  it('extracts "cities of X, Y, and Z"', () => {
    const r = extractPlaceNames({
      description: 'Including the cities of Dallas, Rockwall, and Garland.',
    });
    assert.ok(r.includes('Dallas'));
    assert.ok(r.includes('Rockwall'));
    assert.ok(r.includes('Garland'));
  });

  it('extracts "near X"', () => {
    const r = extractPlaceNames({
      headline: 'Severe Thunderstorm Warning',
      description: 'Near Springfield and Battlefield through 8 PM.',
    });
    assert.ok(r.some((p) => /Springfield/i.test(p)));
    assert.ok(r.some((p) => /Battlefield/i.test(p)));
  });

  it('returns unique names', () => {
    const r = extractPlaceNames({
      description: 'Including the cities of Buffalo, Niagara Falls, and Buffalo.',
    });
    assert.strictEqual(r.filter((p) => /Buffalo/i.test(p)).length, 1);
  });

  it('returns empty when no place patterns', () => {
    const r = extractPlaceNames({ description: 'Winds 60 mph. Hail possible.' });
    assert.deepStrictEqual(r, []);
  });
});
