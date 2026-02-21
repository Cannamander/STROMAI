'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert');
const { computeThresholdsAndScore, FREEZE_EVENT_NAMES } = require('./thresholds');

describe('thresholds', () => {
  it('hail >= 1.25 sets interesting_hail', () => {
    const r = computeThresholdsAndScore({ event: 'Severe Thunderstorm Warning', hail_max_inches: 1.25 }, { interestingHailInches: 1.25 });
    assert.strictEqual(r.interesting_hail, true);
    assert.strictEqual(r.damage_score >= 50 + 40, true);
  });
  it('hail < 1.25 does not set interesting_hail', () => {
    const r = computeThresholdsAndScore({ event: 'Severe Thunderstorm Warning', hail_max_inches: 1.0 }, { interestingHailInches: 1.25 });
    assert.strictEqual(r.interesting_hail, false);
  });

  it('wind >= 70 sets interesting_wind', () => {
    const r = computeThresholdsAndScore({ event: 'Severe Thunderstorm Warning', wind_max_mph: 70 }, { interestingWindMph: 70 });
    assert.strictEqual(r.interesting_wind, true);
  });
  it('wind < 70 does not set interesting_wind', () => {
    const r = computeThresholdsAndScore({ event: 'Severe Thunderstorm Warning', wind_max_mph: 69 }, { interestingWindMph: 70 });
    assert.strictEqual(r.interesting_wind, false);
  });

  it('freeze event + state in FREEZE_RARE_STATES sets interesting_rare_freeze', () => {
    const r = computeThresholdsAndScore(
      { event: 'Freeze Warning', impacted_states: ['TX'] },
      { freezeRareStates: ['TX', 'LA'], freezeEventNames: FREEZE_EVENT_NAMES }
    );
    assert.strictEqual(r.interesting_rare_freeze, true);
    assert.strictEqual(r.interesting_any, true);
  });
  it('freeze event but state not in rare list does not set interesting_rare_freeze', () => {
    const r = computeThresholdsAndScore(
      { event: 'Freeze Warning', impacted_states: ['NJ'] },
      { freezeRareStates: ['TX', 'LA'], freezeEventNames: FREEZE_EVENT_NAMES }
    );
    assert.strictEqual(r.interesting_rare_freeze, false);
  });

  it('interesting_any is OR of hail, wind, rare_freeze', () => {
    assert.strictEqual(computeThresholdsAndScore({ event: 'Other', hail_max_inches: 2 }).interesting_any, true);
    assert.strictEqual(computeThresholdsAndScore({ event: 'Other', wind_max_mph: 80 }).interesting_any, true);
    assert.strictEqual(computeThresholdsAndScore({ event: 'Freeze Warning', impacted_states: ['TX'] }, { freezeRareStates: ['TX'] }).interesting_any, true);
    assert.strictEqual(computeThresholdsAndScore({ event: 'Other' }).interesting_any, false);
  });

  it('damage_score: warning base 50, hail +40, wind +30, tornado +40, capped 100', () => {
    const r = computeThresholdsAndScore({
      event: 'Severe Thunderstorm Warning',
      hail_max_inches: 1.5,
      wind_max_mph: 75,
      tornado_count: 1,
      impacted_states: [],
    }, { interestingHailInches: 1.25, interestingWindMph: 70 });
    assert.strictEqual(r.damage_score, 100);
  });
  it('damage_score capped at 100', () => {
    const r = computeThresholdsAndScore({
      event: 'Severe Thunderstorm Warning',
      hail_max_inches: 2,
      wind_max_mph: 80,
      tornado_count: 1,
      impacted_states: ['TX'],
    }, { interestingHailInches: 1.25, interestingWindMph: 70, freezeRareStates: ['TX'], freezeEventNames: [] });
    assert.strictEqual(r.damage_score, 100);
  });
  it('watch base 10', () => {
    const r = computeThresholdsAndScore({ event: 'Tornado Watch' });
    assert.ok(r.damage_score >= 10 && r.damage_score < 50);
  });
});
