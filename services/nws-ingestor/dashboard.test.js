'use strict';
/**
 * Unit tests for damage console: alert_class, geo_method, zip_density derivation.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert');
const {
  deriveAlertClass,
  deriveGeoMethod,
  deriveZipInferenceMethod,
  computeZipDensity,
} = require('./alertClass');

describe('deriveAlertClass', () => {
  it('returns warning for event containing Warning', () => {
    assert.strictEqual(deriveAlertClass('Severe Thunderstorm Warning'), 'warning');
    assert.strictEqual(deriveAlertClass('Tornado Warning'), 'warning');
    assert.strictEqual(deriveAlertClass('  Flash Flood Warning  '), 'warning');
  });
  it('returns watch for event containing Watch', () => {
    assert.strictEqual(deriveAlertClass('Tornado Watch'), 'watch');
    assert.strictEqual(deriveAlertClass('Severe Thunderstorm Watch'), 'watch');
  });
  it('returns advisory for event containing Advisory', () => {
    assert.strictEqual(deriveAlertClass('Wind Advisory'), 'advisory');
    assert.strictEqual(deriveAlertClass('Frost Advisory'), 'advisory');
  });
  it('returns statement for event containing Statement', () => {
    assert.strictEqual(deriveAlertClass('Public Information Statement'), 'statement');
  });
  it('returns other for non-matching or empty', () => {
    assert.strictEqual(deriveAlertClass(''), 'other');
    assert.strictEqual(deriveAlertClass('Unknown Event'), 'other');
    assert.strictEqual(deriveAlertClass(null), 'other');
    assert.strictEqual(deriveAlertClass(undefined), 'other');
  });
});

describe('deriveGeoMethod', () => {
  it('returns polygon when geom_present is true', () => {
    assert.strictEqual(deriveGeoMethod(true, []), 'polygon');
    assert.strictEqual(deriveGeoMethod(true, ['TXC123']), 'polygon');
  });
  it('returns zone when UGC codes contain Z', () => {
    assert.strictEqual(deriveGeoMethod(false, ['TXZ001']), 'zone');
    assert.strictEqual(deriveGeoMethod(false, ['TXC123', 'TXZ001']), 'zone');
  });
  it('returns county when UGC codes contain C but no Z', () => {
    assert.strictEqual(deriveGeoMethod(false, ['TXC123']), 'county');
    assert.strictEqual(deriveGeoMethod(false, ['TXC123', 'TXC456']), 'county');
  });
  it('returns unknown when no UGC or empty or no Z/C in codes', () => {
    assert.strictEqual(deriveGeoMethod(false, []), 'unknown');
    assert.strictEqual(deriveGeoMethod(false, null), 'unknown');
    assert.strictEqual(deriveGeoMethod(false, ['TXK01']), 'unknown');
  });
});

describe('deriveZipInferenceMethod', () => {
  it('returns polygon_intersect when geom_present and zip_count > 0', () => {
    assert.strictEqual(deriveZipInferenceMethod(true, 10), 'polygon_intersect');
    assert.strictEqual(deriveZipInferenceMethod(true, 1), 'polygon_intersect');
  });
  it('returns none when geom absent or zip_count 0', () => {
    assert.strictEqual(deriveZipInferenceMethod(false, 5), 'none');
    assert.strictEqual(deriveZipInferenceMethod(true, 0), 'none');
    assert.strictEqual(deriveZipInferenceMethod(true, null), 'none');
  });
});

describe('computeZipDensity', () => {
  it('returns zip_count / area_sq_miles when both present', () => {
    assert.strictEqual(computeZipDensity(100, 50), 2);
    assert.strictEqual(computeZipDensity(25, 100), 0.25);
  });
  it('returns null when area is zero or null (divide-by-zero safe)', () => {
    assert.strictEqual(computeZipDensity(100, 0), null);
    assert.strictEqual(computeZipDensity(100, null), null);
    assert.strictEqual(computeZipDensity(100, undefined), null);
  });
  it('returns 0 when zip_count is 0 and area present', () => {
    assert.strictEqual(computeZipDensity(0, 10), 0);
  });
});
