'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert');
const { getZipsQueryParams, ZIPS_INTERSECT_SQL } = require('./db');

describe('getZipsByGeometry / PostGIS params', () => {
  it('uses parameterized SQL ($1) only, no string concatenation', () => {
    assert.ok(ZIPS_INTERSECT_SQL.includes('$1'));
    assert.ok(ZIPS_INTERSECT_SQL.includes('ST_GeomFromGeoJSON($1::text)'));
    assert.strictEqual((ZIPS_INTERSECT_SQL.match(/\$\d+/g) || []).length, 1);
  });

  it('Polygon: returns one param that is stringified GeoJSON with type Polygon', () => {
    const polygon = {
      type: 'Polygon',
      coordinates: [[[-99.5, 32.5], [-99.0, 32.5], [-99.0, 33.0], [-99.5, 33.0], [-99.5, 32.5]]],
    };
    const params = getZipsQueryParams(polygon);
    assert.strictEqual(params.length, 1);
    const parsed = JSON.parse(params[0]);
    assert.strictEqual(parsed.type, 'Polygon');
    assert.ok(Array.isArray(parsed.coordinates));
  });

  it('MultiPolygon: returns one param that is stringified GeoJSON with type MultiPolygon', () => {
    const multi = {
      type: 'MultiPolygon',
      coordinates: [[[[-99.5, 32.5], [-99.0, 32.5], [-99.0, 33.0], [-99.5, 33.0], [-99.5, 32.5]]]],
    };
    const params = getZipsQueryParams(multi);
    assert.strictEqual(params.length, 1);
    const parsed = JSON.parse(params[0]);
    assert.strictEqual(parsed.type, 'MultiPolygon');
    assert.ok(Array.isArray(parsed.coordinates));
  });

  it('null or non-object returns empty params', () => {
    assert.deepStrictEqual(getZipsQueryParams(null), []);
    assert.deepStrictEqual(getZipsQueryParams(undefined), []);
    assert.deepStrictEqual(getZipsQueryParams(''), []);
  });
});
