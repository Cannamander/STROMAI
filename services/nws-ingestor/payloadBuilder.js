'use strict';
/**
 * Build versioned delivery payload for an alert (for outbox and API).
 */
const config = require('./config');
const { buildEventKey } = require('./db');
const { computeThresholdsAndScore } = require('./thresholds');

/**
 * Build payload for property_enrichment_v1 (or generic). Version 1.
 * @param {object} alert - Row from alert_impacted_zips (alert_id, event, severity, sent, effective, expires, impacted_states, zips, zip_count, lsr_match_count, hail_max_inches, wind_max_mph, tornado_count, flood_count, damage_keyword_hits, interesting_hail, interesting_wind, interesting_rare_freeze, interesting_any, damage_score)
 * @param {number} [payloadVersion=1]
 * @returns {{ alert_id, event, severity, sent, effective, expires, impacted_states, impacted_zips, zip_count, lsr_summary, thresholds_used, interesting_flags, damage_score, event_key }}
 */
function buildDeliveryPayload(alert, payloadVersion = 1) {
  const zips = alert.zips || alert.impacted_zips || [];
  const eventKey = buildEventKey(alert.alert_id, payloadVersion, zips);
  const thresholdsUsed = {
    hail_inches: config.interestingHailInches ?? 1.25,
    wind_mph: config.interestingWindMph ?? 70,
    freeze_rare_states: config.freezeRareStates ?? [],
  };
  return {
    alert_id: alert.alert_id,
    event: alert.event,
    severity: alert.severity,
    sent: alert.sent,
    effective: alert.effective,
    expires: alert.expires,
    impacted_states: alert.impacted_states || [],
    impacted_zips: zips,
    zip_count: alert.zip_count ?? zips.length,
    lsr_summary: {
      hail_max_inches: alert.hail_max_inches ?? null,
      wind_max_mph: alert.wind_max_mph ?? null,
      tornado_count: alert.tornado_count ?? 0,
      flood_count: alert.flood_count ?? 0,
      damage_keyword_hits: alert.damage_keyword_hits ?? 0,
    },
    thresholds_used: thresholdsUsed,
    interesting_flags: {
      hail: !!alert.interesting_hail,
      wind: !!alert.interesting_wind,
      rare_freeze: !!alert.interesting_rare_freeze,
      any: !!alert.interesting_any,
    },
    damage_score: alert.damage_score ?? 0,
    event_key: eventKey,
  };
}

module.exports = { buildDeliveryPayload };
