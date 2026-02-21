'use strict';
/**
 * Mock adapter for property_enrichment_v1. Marks sent with remote_job_id="mock" without external calls.
 * Replace with real HTTP client when integrating.
 * @param {object} payload - buildDeliveryPayload output
 * @returns {Promise<{ success: boolean, remote_job_id?: string, error?: string }>}
 */
async function send(payload) {
  if (!payload || !payload.event_key) {
    return { success: false, error: 'Invalid payload' };
  }
  return { success: true, remote_job_id: 'mock' };
}

module.exports = { send };
