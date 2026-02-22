'use strict';
/**
 * Build the exact AI-STORMS BULK SUMMARY clipboard format for tests and optional API use.
 * @param {object} opts - { alerts: array, selectedCount: number, filtersString: string }
 * @returns {string}
 */
function buildBulkSummaryText(opts) {
  const { alerts = [], selectedCount = 0, filtersString = '' } = opts;
  const lines = [
    'AI-STORMS BULK SUMMARY',
    'generated_at: ' + new Date().toISOString(),
    'selected_count: ' + selectedCount,
    'filters: ' + filtersString,
    '',
  ];
  alerts.forEach((a) => {
    const states = Array.isArray(a.impacted_states) ? a.impacted_states.join(',') : (a.impacted_states || '');
    const zipsCount = a.zip_count != null ? a.zip_count : (a.zips && a.zips.length ? a.zips.length : 0);
    lines.push('- alert_id: ' + (a.alert_id || ''));
    lines.push('  event: ' + (a.event || ''));
    lines.push('  class: ' + (a.alert_class || 'other'));
    lines.push('  states: ' + states);
    lines.push('  zips_count: ' + zipsCount);
    lines.push('  lsr_count: ' + (a.lsr_match_count ?? 0));
    lines.push('  hail_max_inches: ' + (a.hail_max_inches ?? ''));
    lines.push('  wind_max_mph: ' + (a.wind_max_mph ?? ''));
    lines.push('  interesting: hail=' + (a.interesting_hail ? 'T' : 'F') + ' wind=' + (a.interesting_wind ? 'T' : 'F') + ' rare_freeze=' + (a.interesting_rare_freeze ? 'T' : 'F') + ' any=' + (a.interesting_any ? 'T' : 'F'));
    lines.push('  triage_status: ' + (a.triage_status || 'new'));
    lines.push('  confidence: ' + (a.confidence_level || 'low'));
    lines.push('  score: ' + (a.damage_score ?? 0));
    lines.push('  expires: ' + (a.expires || ''));
    lines.push('');
  });
  return lines.join('\n');
}

module.exports = { buildBulkSummaryText };
