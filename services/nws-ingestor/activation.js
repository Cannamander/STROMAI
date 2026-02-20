const config = require('./config');

/** Event types we treat as actionable (from NWS_EVENTS env or default). */
function getAllowedEventsSet() {
  const list = config.allowedEvents || [];
  return new Set(list.map((e) => String(e).trim()));
}

/**
 * Classify a normalized alert for activation. Actionable = event in NWS_EVENTS, or (if INCLUDE_WATCH) event ends in "Watch".
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

  const allowed = getAllowedEventsSet();
  if (allowed.has(event)) {
    return { actionable: true, kind: 'warning', reason: 'in NWS_EVENTS' };
  }
  if (config.includeWatch && event.endsWith('Watch')) {
    return { actionable: true, kind: 'watch', reason: 'watch (INCLUDE_WATCH=true)' };
  }

  return { actionable: false, kind: 'other', reason: 'not in NWS_EVENTS or watch' };
}

/**
 * @param {object} alert - Normalized alert
 * @returns {boolean}
 */
function isActionable(alert) {
  return classifyAlert(alert).actionable;
}

module.exports = { classifyAlert, isActionable, getAllowedEventsSet };
