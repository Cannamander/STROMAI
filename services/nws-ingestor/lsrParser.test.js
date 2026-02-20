'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert');
const { parseLine } = require('./lsrParser');

describe('lsrParser', () => {
  it('extracts hail from "HAIL 2.00 IN"', () => {
    const r = parseLine('HAIL 2.00 IN');
    assert.strictEqual(r.hail_in, 2);
    assert.strictEqual(r.wind_gust_mph, null);
    assert.ok(r.raw_text.includes('HAIL'));
  });

  it('extracts wind from "TSTM WND GST 70 MPH"', () => {
    const r = parseLine('TSTM WND GST 70 MPH');
    assert.strictEqual(r.hail_in, null);
    assert.strictEqual(r.wind_gust_mph, 70);
    assert.ok(r.raw_text.includes('70'));
  });

  it('extracts wind from "WND GST 58 MPH"', () => {
    const r = parseLine('WND GST 58 MPH');
    assert.strictEqual(r.hail_in, null);
    assert.strictEqual(r.wind_gust_mph, 58);
  });
});
