'use strict';
/**
 * Threshold and damage_score logic for alerts. Used by ingest (via DB set-based update) and API.
 */
const config = require('./config');

const FREEZE_EVENT_NAMES = [
  'Freeze Warning',
  'Hard Freeze Warning',
  'Freeze Watch',
  'Frost Advisory',
];

/**
 * Compute interesting flags and damage_score for one alert row (for use in API or tests).
 * @param {object} row - { event, severity?, hail_max_inches?, wind_max_mph?, tornado_count?, flood_count?, impacted_states? }
 * @param {object} [opts] - { hailInches, windMph, freezeRareStates, freezeEventNames }
 * @returns {{ interesting_hail: boolean, interesting_wind: boolean, interesting_rare_freeze: boolean, interesting_any: boolean, damage_score: number }}
 */
function computeThresholdsAndScore(row, opts = {}) {
  const hailInches = opts.interestingHailInches ?? config.interestingHailInches ?? 1.25;
  const windMph = opts.interestingWindMph ?? config.interestingWindMph ?? 70;
  const freezeRareStates = opts.freezeRareStates ?? config.freezeRareStates ?? [];
  const freezeEvents = opts.freezeEventNames ?? FREEZE_EVENT_NAMES;

  const event = (row.event && String(row.event)) || '';
  const states = Array.isArray(row.impacted_states) ? row.impacted_states : [];
  const hail = row.hail_max_inches != null ? Number(row.hail_max_inches) : null;
  const wind = row.wind_max_mph != null ? Number(row.wind_max_mph) : null;
  const tornadoCount = row.tornado_count != null ? Number(row.tornado_count) : 0;

  const interesting_hail = hail != null && hail >= hailInches;
  const interesting_wind = wind != null && wind >= windMph;
  const isFreezeEvent = freezeEvents.some((e) => event === e);
  const hasRareState = freezeRareStates.length > 0 && states.some((s) => freezeRareStates.includes(String(s).toUpperCase()));
  const interesting_rare_freeze = isFreezeEvent && hasRareState;
  const interesting_any = interesting_hail || interesting_wind || interesting_rare_freeze;

  let base = 0;
  if (event.endsWith(' Warning')) base = 50;
  else if (event.endsWith(' Watch')) base = 10;
  let score = base;
  if (interesting_hail) score += 40;
  if (interesting_wind) score += 30;
  if (interesting_rare_freeze) score += 35;
  if (tornadoCount > 0) score += 40;
  const damage_score = Math.min(100, Math.max(0, score));

  return {
    interesting_hail,
    interesting_wind,
    interesting_rare_freeze,
    interesting_any,
    damage_score,
  };
}

module.exports = {
  FREEZE_EVENT_NAMES,
  computeThresholdsAndScore,
};
