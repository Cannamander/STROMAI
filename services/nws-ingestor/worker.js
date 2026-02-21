#!/usr/bin/env node
'use strict';
/**
 * Poll zip_delivery_outbox for status=queued, send via destination adapter, update status.
 * Run with: npm run worker (or node services/nws-ingestor/worker.js)
 */
require('dotenv').config();
const { getOutbox, updateOutboxRow } = require('./db');
const { send: sendPropertyEnrichment } = require('./destinations/property_enrichment_v1');

const POLL_MS = parseInt(process.env.WORKER_POLL_MS, 10) || 5000;

const adapters = {
  property_enrichment_v1: sendPropertyEnrichment,
  manual_entry: sendPropertyEnrichment,
};

async function processOne(row) {
  const sendFn = adapters[row.destination] || sendPropertyEnrichment;
  await updateOutboxRow(row.id, { status: 'sending' });
  try {
    const payload = row.payload || {};
    const result = await sendFn(payload);
    if (result && result.success) {
      await updateOutboxRow(row.id, {
        status: 'sent',
        attempt_count: (row.attempt_count || 0) + 1,
        last_attempt_at: new Date().toISOString(),
        last_error: null,
        remote_job_id: result.remote_job_id || null,
      });
    } else {
      await updateOutboxRow(row.id, {
        status: 'failed',
        attempt_count: (row.attempt_count || 0) + 1,
        last_attempt_at: new Date().toISOString(),
        last_error: (result && result.error) || 'Send failed',
      });
    }
  } catch (e) {
    await updateOutboxRow(row.id, {
      status: 'failed',
      attempt_count: (row.attempt_count || 0) + 1,
      last_attempt_at: new Date().toISOString(),
      last_error: e.message,
    });
  }
}

async function tick() {
  const rows = await getOutbox('queued', 5);
  for (const row of rows) {
    await processOne(row);
  }
}

async function run() {
  console.log('AI-STORMS delivery worker started (poll every ' + POLL_MS + 'ms)');
  for (;;) {
    try {
      await tick();
    } catch (e) {
      console.error('Worker tick error:', e.message);
    }
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
