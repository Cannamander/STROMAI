'use strict';
/**
 * Geo diagnostics: ensure we do not strip geometry during NWS alert normalization.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');
const { normalizeFeature } = require('./normalize');

const FIXTURES_DIR = path.join(__dirname, 'fixtures');

function loadFixture(name) {
  const p = path.join(FIXTURES_DIR, name);
  const raw = fs.readFileSync(p, 'utf8');
  return JSON.parse(raw);
}

describe('normalizeFeature geometry retention', () => {
  it('retains geometry when feature has Polygon geometry', () => {
    const feature = loadFixture('feature-with-polygon.json');
    const out = normalizeFeature(feature);
    assert(out != null, 'normalized output should be non-null');
    assert.strictEqual(out.geometry_json != null, true, 'geometry_json should be present (geom_present=true)');
    assert.strictEqual(out.geometry_json.type, 'Polygon', 'geometry type should be Polygon');
    assert(Array.isArray(out.geometry_json.coordinates), 'coordinates should be array');
    assert.deepStrictEqual(
      out.geometry_json.coordinates,
      feature.geometry.coordinates,
      'geometry coordinates must not be stripped or altered'
    );
  });

  it('sets geometry_json null when feature has geometry=null', () => {
    const feature = loadFixture('feature-no-geometry.json');
    const out = normalizeFeature(feature);
    assert(out != null, 'normalized output should be non-null');
    assert.strictEqual(out.geometry_json, null, 'geometry_json must be null when feature.geometry is null');
    assert.strictEqual(out.geometry_json != null, false, 'geom_present should be false');
  });

  it('does not strip or modify polygon geometry object reference', () => {
    const feature = loadFixture('feature-with-polygon.json');
    const geom = feature.geometry;
    const out = normalizeFeature(feature);
    assert.strictEqual(out.geometry_json, geom, 'geometry should be same reference (not cloned/stripped)');
  });
});
