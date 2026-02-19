const config = require('./config');

/** Warnings that are actionable by default (no INCLUDE_WATCH needed). */
const WARNING_ALLOWLIST = [
  'Tornado Warning',
  'Severe Thunderstorm Warning',
  'Flash Flood Warning',
  'High Wind Warning',
  'Hurricane Warning',
  'Ice Storm Warning',
  'Winter Storm Warning',
];

/**
 * Classify a normalized alert for activation (warnings-only by default, watches optional).
 * @param {object} alert - Normalized alert (must have status, messageType, event)
 * @returns {{ actionable: boolean, kind: 'warning'|'watch'|'other', reason: string }}
 */
function classifyAlert(alert) {
  if (!alert || typeof alert !== 'object') {
    return { actionable: false, kind: 'other', reason: 'missing alert' };
  }

  const status = alert.status != null ? String(alert.status).trim() : '';
  const messageType = alert.messageType != null ? String(alert.messageType).trim() : '';
  const event = alert.event != null ? String(alert.event).trim() : '';

  if (status.toLowerCase() !== 'actual') {
    return { actionable: false, kind: 'other', reason: 'status is not Actual' };
  }
  if (messageType.toLowerCase() === 'cancel') {
    return { actionable: false, kind: 'other', reason: 'messageType is Cancel' };
  }

  if (WARNING_ALLOWLIST.includes(event)) {
    return { actionable: true, kind: 'warning', reason: 'warning allowlist' };
  }
  if (config.includeWatch && event.endsWith('Watch')) {
    return { actionable: true, kind: 'watch', reason: 'watch (INCLUDE_WATCH=true)' };
  }

  return { actionable: false, kind: 'other', reason: 'not warning or watch' };
}

/**
 * @param {object} alert - Normalized alert
 * @returns {boolean}
 */
function isActionable(alert) {
  return classifyAlert(alert).actionable;
}

module.exports = { classifyAlert, isActionable, WARNING_ALLOWLIST };
