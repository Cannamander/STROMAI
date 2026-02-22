'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert');
const {
  extractSignalsFromText,
  parseHailFromText,
  parseWindFromText,
  countDamageKeywords,
} = require('./descriptionSignals');

describe('parseHailFromText', () => {
  it('parses explicit inch values', () => {
    assert.strictEqual(parseHailFromText('1.25 inch hail reported'), 1.25);
    assert.strictEqual(parseHailFromText('hail up to 2 inches'), 2);
    assert.strictEqual(parseHailFromText('1.5 inch diameter'), 1.5);
  });
  it('parses size names', () => {
    assert.strictEqual(parseHailFromText('golf ball size hail'), 1.75);
    assert.strictEqual(parseHailFromText('quarter sized hail'), 1);
    assert.strictEqual(parseHailFromText('half dollar hail'), 1.25);
  });
  it('returns largest when multiple', () => {
    assert.strictEqual(parseHailFromText('quarter to golf ball size hail'), 1.75);
  });
});

describe('parseWindFromText', () => {
  it('parses mph', () => {
    assert.strictEqual(parseWindFromText('winds to 70 mph'), 70);
    assert.strictEqual(parseWindFromText('60 mph wind gusts'), 60);
    assert.strictEqual(parseWindFromText('gusts up to 80 mph'), 80);
  });
  it('returns largest when multiple', () => {
    assert.strictEqual(parseWindFromText('winds 60 mph with gusts to 75 mph'), 75);
  });
});

describe('countDamageKeywords', () => {
  it('counts damage-related and observed language', () => {
    assert.strictEqual(countDamageKeywords(''), 0);
    assert.ok(countDamageKeywords('damage reported') >= 1);
    assert.ok(countDamageKeywords('trees down and power lines down') >= 2);
    assert.ok(countDamageKeywords('spotter report of damage') >= 2);
  });
});

describe('extractSignalsFromText', () => {
  it('combines headline and description', () => {
    const r = extractSignalsFromText({
      headline: 'Severe Thunderstorm Warning',
      description: 'Quarter to golf ball size hail and 70 mph winds possible. Damage reported.',
    });
    assert.strictEqual(r.hail_inches, 1.75);
    assert.strictEqual(r.wind_mph, 70);
    assert.ok(r.damage_keyword_count >= 1);
  });
});
