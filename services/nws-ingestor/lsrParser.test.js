'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert');
const { parseLine, eventTypeFromLine, parseLsrProductToObservations, parseTimeFromLine } = require('./lsrParser');

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

  it('event_type normalization: HAIL', () => {
    assert.strictEqual(eventTypeFromLine('HAIL 1.25 IN'), 'HAIL');
  });
  it('event_type normalization: TORNADO', () => {
    assert.strictEqual(eventTypeFromLine('TORNADO 3 NE DALLAS TX'), 'TORNADO');
  });
  it('event_type normalization: TSTM_WND_GST', () => {
    assert.strictEqual(eventTypeFromLine('TSTM WND GST 60 MPH'), 'TSTM_WND_GST');
  });

  it('hail_inches parsing: fraction "1 1/2" => 1.5', () => {
    const rows = parseLsrProductToObservations('HAIL 1 1/2 IN', 'p1', null, null);
    assert.ok(rows.length >= 1 && rows[0].hail_inches >= 1.4 && rows[0].hail_inches <= 1.6);
  });
  it('hail_inches parsing: decimal 1.75', () => {
    const rows = parseLsrProductToObservations('HAIL 1.75 IN', 'p1', null, null);
    assert.ok(rows.length >= 1 && rows[0].hail_inches === 1.75);
  });

  it('parseTimeFromLine returns fallback when no time in line', () => {
    const issued = new Date('2025-01-15T18:00:00Z');
    const t = parseTimeFromLine('HAIL 2 IN', issued);
    assert.ok(t instanceof Date);
    assert.strictEqual(t.getTime(), issued.getTime());
  });

  it('parseLsrProductToObservations returns observation_id and event_type', () => {
    const text = 'HAIL 1.00 IN\nTSTM WND GST 65 MPH';
    const rows = parseLsrProductToObservations(text, 'prod-1', '2025-01-15T18:00:00Z', null);
    assert.ok(Array.isArray(rows));
    assert.ok(rows.length >= 1);
    assert.ok(rows[0].observation_id.startsWith('prod-1_'));
    assert.strictEqual(rows[0].event_type, 'HAIL');
    assert.ok(rows[0].hail_inches === 1 || rows[0].hail_inches >= 0.99);
  });
});
