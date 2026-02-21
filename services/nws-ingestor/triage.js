'use strict';
/**
 * Operator Trust Layer v1: deterministic triage status and explainability.
 * Pure function computeTriage(alert) -> { status, reasons, confidence_level }.
 * Used by ingest (for system-owned rows only) and by reset_to_system.
 */

const HAIL_THRESHOLD_DISPLAY = 1.25;
const WIND_THRESHOLD_DISPLAY = 70;

const TRIAGE_STATUSES = new Set(['new', 'monitoring', 'actionable', 'sent_manual', 'suppressed']);
const CONFIDENCE_LEVELS = new Set(['low', 'medium', 'high']);
const TRIAGE_ACTIONS = new Set(['set_actionable', 'set_monitoring', 'set_suppressed', 'set_sent_manual', 'reset_to_system']);

/**
 * Build short explainability reasons for UI.
 * @param {object} alert - Row with alert_class, interesting_any, geom_present, lsr_match_count, interesting_hail, interesting_wind, hail_max_inches, wind_max_mph, event
 * @param {string} status - Computed triage status
 * @returns {string[]}
 */
function buildReasons(alert, status) {
  const reasons = [];
  const cls = (alert.alert_class && String(alert.alert_class)) || 'other';
  const geom = alert.geom_present === true;
  const lsr = (alert.lsr_match_count != null ? Number(alert.lsr_match_count) : 0) || 0;
  const interesting = alert.interesting_any === true;
  const hail = alert.hail_max_inches != null ? Number(alert.hail_max_inches) : null;
  const wind = alert.wind_max_mph != null ? Number(alert.wind_max_mph) : null;
  const interestingHail = alert.interesting_hail === true;
  const interestingWind = alert.interesting_wind === true;

  if (cls === 'warning') {
    reasons.push('Warning product');
    if (interestingHail && hail != null) {
      reasons.push('Hail >= ' + HAIL_THRESHOLD_DISPLAY + ' in (' + hail + ')');
    }
    if (interestingWind && wind != null) {
      reasons.push('Wind >= ' + WIND_THRESHOLD_DISPLAY + ' mph (' + wind + ')');
    }
    if (lsr > 0) {
      reasons.push('LSR matches: ' + lsr);
    }
    if (geom) {
      reasons.push('Geometry present');
    } else {
      reasons.push('Geometry missing (zone-based)');
    }
    if (status === 'monitoring' && (geom || lsr > 0) && !interesting) {
      reasons.push('Awaiting LSR confirmation');
    }
  } else if (cls === 'watch') {
    reasons.push('Watch product');
    reasons.push(geom ? 'Geometry present' : 'Geometry missing (zone-based)');
    if (lsr > 0) reasons.push('LSR matches: ' + lsr);
  } else {
    reasons.push(cls === 'advisory' ? 'Advisory' : cls === 'statement' ? 'Statement' : 'Other');
    if (geom) reasons.push('Geometry present');
    else if (lsr > 0) reasons.push('LSR matches: ' + lsr);
  }

  return reasons;
}

/**
 * Compute confidence_level from alert state (v1 rules).
 * high: geom_present AND lsr_match_count > 0 AND interesting_any
 * medium: (geom_present AND (interesting_any OR lsr_match_count > 0)) OR (lsr_match_count > 0)
 * low: otherwise
 */
function computeConfidence(alert) {
  const geom = alert.geom_present === true;
  const lsr = (alert.lsr_match_count != null ? Number(alert.lsr_match_count) : 0) || 0;
  const interesting = alert.interesting_any === true;

  if (geom && lsr > 0 && interesting) return 'high';
  if ((geom && (interesting || lsr > 0)) || lsr > 0) return 'medium';
  return 'low';
}

/**
 * Pure function: compute triage status and explainability for one alert.
 * Operator override is NOT handled here; ingest skips rows with triage_status_source = 'operator'.
 *
 * Rules (v1):
 * 1) warning + interesting_any => actionable
 * 2) else warning + (geom_present OR lsr_match_count > 0) => monitoring
 * 3) else watch => monitoring
 * 4) else advisory/statement/other => monitoring
 * 5) else => new (fallback)
 *
 * @param {object} alert - Row from alert_impacted_zips: alert_class, interesting_any, geom_present, lsr_match_count, interesting_hail, interesting_wind, hail_max_inches, wind_max_mph, event
 * @returns {{ status: string, reasons: string[], confidence_level: string }}
 */
function computeTriage(alert) {
  if (!alert || typeof alert !== 'object') {
    return { status: 'new', reasons: [], confidence_level: 'low' };
  }

  const cls = (alert.alert_class && String(alert.alert_class)) || 'other';
  const interesting = alert.interesting_any === true;
  const geom = alert.geom_present === true;
  const lsr = (alert.lsr_match_count != null ? Number(alert.lsr_match_count) : 0) || 0;

  let status = 'new';

  if (cls === 'warning') {
    if (interesting) {
      status = 'actionable';
    } else if (geom || lsr > 0) {
      status = 'monitoring';
    } else {
      status = 'monitoring';
    }
  } else if (cls === 'watch') {
    status = 'monitoring';
  } else if (['advisory', 'statement', 'other'].includes(cls)) {
    status = 'monitoring';
  }

  const reasons = buildReasons(alert, status);
  const confidence_level = computeConfidence(alert);

  return {
    status,
    reasons,
    confidence_level: CONFIDENCE_LEVELS.has(confidence_level) ? confidence_level : 'low',
  };
}

/**
 * Map triage action to new status (for operator actions).
 * @param {string} action - set_actionable | set_monitoring | set_suppressed | set_sent_manual | reset_to_system
 * @returns {string|null} - New triage_status or null for reset_to_system (caller recomputes)
 */
function actionToStatus(action) {
  if (action === 'reset_to_system') return null;
  switch (action) {
    case 'set_actionable': return 'actionable';
    case 'set_monitoring': return 'monitoring';
    case 'set_suppressed': return 'suppressed';
    case 'set_sent_manual': return 'sent_manual';
    default: return null;
  }
}

module.exports = {
  TRIAGE_STATUSES,
  TRIAGE_ACTIONS,
  CONFIDENCE_LEVELS,
  computeTriage,
  actionToStatus,
};
