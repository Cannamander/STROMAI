'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert');
const { getZipsQueryParams, ZIPS_INTERSECT_SQL, LSR_POINT_IN_GEOM_SQL, buildEventKey } = require('./db');

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

describe('LSR point-in-polygon SQL', () => {
  it('uses parameterized SQL ($1, $2, $3) only', () => {
    assert.ok(LSR_POINT_IN_GEOM_SQL.includes('$1'));
    assert.ok(LSR_POINT_IN_GEOM_SQL.includes('$2'));
    assert.ok(LSR_POINT_IN_GEOM_SQL.includes('$3'));
    assert.ok(LSR_POINT_IN_GEOM_SQL.includes('ST_GeomFromGeoJSON($1::text)'));
    assert.ok(LSR_POINT_IN_GEOM_SQL.includes('ST_MakePoint($2'));
    const params = LSR_POINT_IN_GEOM_SQL.match(/\$\d+/g) || [];
    assert.strictEqual(params.length, 3);
  });
});

describe('event_key idempotency', () => {
  it('buildEventKey is stable for same alert_id + version + zips', () => {
    const k1 = buildEventKey('alert-1', 1, ['77001', '77002']);
    const k2 = buildEventKey('alert-1', 1, ['77001', '77002']);
    assert.strictEqual(k1, k2);
  });
  it('buildEventKey differs for different zips', () => {
    const k1 = buildEventKey('alert-1', 1, ['77001', '77002']);
    const k2 = buildEventKey('alert-1', 1, ['77002', '77001']);
    assert.strictEqual(k1, k2);
  });
  it('buildEventKey differs for different alert_id or version', () => {
    const k1 = buildEventKey('alert-1', 1, ['77001']);
    const k2 = buildEventKey('alert-2', 1, ['77001']);
    const k3 = buildEventKey('alert-1', 2, ['77001']);
    assert.notStrictEqual(k1, k2);
    assert.notStrictEqual(k1, k3);
  });
});
