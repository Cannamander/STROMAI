#!/usr/bin/env node
'use strict';
/**
 * HTTP API for alerts, deliveries, and outbox. Start with: npm run api
 * Auth: Supabase Auth (Bearer token). Set SUPABASE_URL + SUPABASE_ANON_KEY to verify JWT.
 */
require('dotenv').config();
const express = require('express');
const { getAlerts, getAlertById, getAlertNwsStatement, getAlertsByIds, updateAlertTriage, insertTriageAudit, getTriageAudit, enqueueDelivery, enqueueDeliveryOnce, getOutbox, getOutboxById, getOutboxByState, updateOutboxRow, cancelOutboxRow, getStateSummary, getStatePlaces, getMapAlerts, getMapZips, getMapMeta, setLastIngestRun, getClients, getClientById, createClient, updateClient, getClientConfig, putClientConfig, getOperatorPrefs, setOperatorPrefs, getAlertsForClient, getAlertsForClientQueue } = require('./db');
const { buildDeliveryPayload } = require('./payloadBuilder');
const { computeTriage, actionToStatus, TRIAGE_ACTIONS } = require('./triage');
const { ingestOnce } = require('./index');
const { runLsrRecheckForAlert } = require('./lsrEnrich');
const config = require('./config');

const path = require('path');
const app = express();
const PORT = process.env.API_PORT || 3000;

app.use(express.json());

// Operator UI static files (optional)
const publicDir = path.join(__dirname, 'public');
try {
  const fs = require('fs');
  if (fs.existsSync(publicDir)) app.use(express.static(publicDir));
} catch (_) {}

// Frontend config (Supabase URL/anon key for auth)
app.get('/config.json', (req, res) => {
  res.json({
    supabaseUrl: process.env.SUPABASE_URL || '',
    supabaseAnonKey: process.env.SUPABASE_ANON_KEY || '',
    apiBase: '',
  });
});

// Optional auth: if SUPABASE_URL is set, require valid Bearer token; else allow unauthenticated (dev).
async function authMiddleware(req, res, next) {
  const auth = req.headers.authorization;
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_ANON_KEY) {
    return next();
  }
  if (!auth || !auth.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or invalid Authorization header' });
  }
  const token = auth.slice(7);
  try {
    let createClient;
    try {
      createClient = require('@supabase/supabase-js').createClient;
    } catch (_) {
      return res.status(501).json({ error: 'Supabase not installed; set SUPABASE_URL only when @supabase/supabase-js is installed' });
    }
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
    const { data: { user }, error } = await supabase.auth.getUser(token);
    if (error || !user) return res.status(401).json({ error: 'Invalid token' });
    req.user = user;
    next();
  } catch (e) {
    return res.status(401).json({ error: 'Auth failed' });
  }
}

app.use(authMiddleware);

// POST /v1/ingest/once – run NWS ingest once (fetch all alerts, derive ZIPs, LSR pipeline, thresholds)
app.post('/v1/ingest/once', async (req, res) => {
  try {
    await setLastIngestRun(); // so dashboard "only from last ingest" shows this run's alerts
    const summary = await ingestOnce({ mode: 'once' });
    res.json({ ok: true, ...summary });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// GET /v1/alerts — one row per alert_id.
// Filters: state, class, interesting, geom_present, lsr_present, min_score, max_score, min_zip_count, max_zip_count, max_area_sq_miles.
// Sort: sort_mode=action|damage|tight|expires|broad (default action), or sort_by=<column>&sort_dir=asc|desc.
// Example URLs:
//   /v1/alerts?sort_mode=action&class=warning&interesting=true&state=TX
//   /v1/alerts?sort_mode=expires&geom_present=true
//   /v1/alerts?sort_by=damage_score&sort_dir=desc&state=OK
app.get('/v1/alerts', async (req, res) => {
  try {
    const active = req.query.active === 'true';
    const min_score = req.query.min_score != null ? Number(req.query.min_score) : undefined;
    const max_score = req.query.max_score != null ? Number(req.query.max_score) : undefined;
    const state = req.query.state || undefined;
    const interesting = req.query.interesting;
    const class_ = req.query.class;
    const geom_present = req.query.geom_present;
    const lsr_present = req.query.lsr_present;
    const min_zip_count = req.query.min_zip_count != null ? Number(req.query.min_zip_count) : undefined;
    const max_zip_count = req.query.max_zip_count != null ? Number(req.query.max_zip_count) : undefined;
    const max_area_sq_miles = req.query.max_area_sq_miles != null ? Number(req.query.max_area_sq_miles) : undefined;
    const sort_mode = req.query.sort_mode || (req.query.work_queue === 'true' ? 'work_queue' : undefined);
    const sort_by = req.query.sort_by || undefined;
    const sort_dir = req.query.sort_dir || undefined;
    const actionable = req.query.actionable === 'true';
    const work_queue = req.query.work_queue === 'true';
    const triage_status = req.query.triage_status || undefined;
    const since_last_ingest = req.query.since_last_ingest !== 'false'; // default true for testing: only show alerts from last "run ingest once"
    const rows = await getAlerts({
      active,
      since_last_ingest,
      min_score,
      max_score,
      state,
      interesting: interesting === 'true' ? true : interesting === 'false' ? false : undefined,
      actionable,
      class: class_,
      geom_present: geom_present === 'true' ? true : geom_present === 'false' ? false : undefined,
      lsr_present: lsr_present === 'true' ? true : lsr_present === 'false' ? false : undefined,
      min_zip_count,
      max_zip_count,
      max_area_sq_miles,
      sort_mode,
      sort_by,
      sort_dir,
      work_queue,
      triage_status,
    });
    res.json({ alerts: rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

const BULK_MAX = config.bulkMax ?? 200;

// GET /v1/alerts/zips.csv?alert_ids=id1,id2,...&mode=per_alert|unique — bulk ZIP export (must be before /v1/alerts/:alert_id)
app.get('/v1/alerts/zips.csv', async (req, res) => {
  try {
    const raw = req.query.alert_ids;
    const mode = (req.query.mode || 'per_alert').toLowerCase();
    if (!raw || typeof raw !== 'string') return res.status(400).json({ error: 'alert_ids required (comma-separated)' });
    const alertIds = raw.split(',').map((s) => s.trim()).filter(Boolean);
    if (alertIds.length === 0) return res.status(400).json({ error: 'alert_ids required' });
    if (alertIds.length > BULK_MAX) return res.status(400).json({ error: 'alert_ids exceeds BULK_MAX (' + BULK_MAX + ')' });
    const alerts = await getAlertsByIds(alertIds);
    if (mode === 'unique') {
      const set = new Set();
      for (const a of alerts) for (const z of (a.zips || [])) set.add(z);
      const zips = [...set].sort();
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename="alerts-unique-zips.csv"');
      res.send('zip\n' + zips.join('\n'));
    } else {
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename="alerts-zips.csv"');
      const lines = ['alert_id,zip'];
      for (const a of alerts) for (const z of (a.zips || [])) lines.push(a.alert_id + ',' + z);
      res.send(lines.join('\n'));
    }
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /v1/alerts/triage/bulk — bulk triage update
app.post('/v1/alerts/triage/bulk', async (req, res) => {
  try {
    const body = req.body || {};
    let alertIds = Array.isArray(body.alert_ids) ? body.alert_ids : [];
    alertIds = alertIds.map((id) => String(id).trim()).filter(Boolean);
    if (alertIds.length === 0) return res.status(400).json({ error: 'alert_ids required (array)' });
    if (alertIds.length > BULK_MAX) return res.status(400).json({ error: 'alert_ids exceeds BULK_MAX (' + BULK_MAX + ')' });
    const action = body.action && String(body.action).toLowerCase();
    if (!action || !TRIAGE_ACTIONS.has(action)) return res.status(400).json({ error: 'action required: set_actionable, set_monitoring, set_suppressed, set_sent_manual, or reset_to_system' });
    const note = body.note != null ? String(body.note) : null;
    const actor = req.user && (req.user.email || req.user.id);
    const failed = [];
    const updated_alerts = [];
    const client = await require('./db').pool.connect();
    try {
      await client.query('BEGIN');
      for (const alertId of alertIds) {
        try {
          const alert = (await client.query('SELECT * FROM public.alert_impacted_zips WHERE alert_id = $1', [alertId])).rows[0];
          if (!alert) { failed.push({ alert_id: alertId, error: 'Alert not found' }); continue; }
          const prevStatus = alert.triage_status || 'new';
          if (action === 'reset_to_system') {
            const { status, reasons, confidence_level } = computeTriage(alert);
            await client.query(
              `UPDATE public.alert_impacted_zips SET triage_status = $1, triage_status_source = 'system', triage_reasons = $2, confidence_level = $3, triage_status_updated_at = now(), triage_status_updated_by = NULL WHERE alert_id = $4`,
              [status, reasons, confidence_level, alertId]
            );
            await client.query(
              `INSERT INTO public.nws_triage_audit (alert_id, actor, action, prev_status, new_status, note) VALUES ($1, $2, $3, $4, $5, $6)`,
              [alertId, actor, action, prevStatus, status, note]
            );
            updated_alerts.push({ alert_id: alertId, triage_status: status, triage_status_source: 'system', triage_status_updated_at: new Date().toISOString() });
          } else {
            const newStatus = actionToStatus(action);
            if (!newStatus) { failed.push({ alert_id: alertId, error: 'Invalid action' }); continue; }
            await client.query(
              `UPDATE public.alert_impacted_zips SET triage_status = $1, triage_status_source = 'operator', triage_status_updated_at = now(), triage_status_updated_by = $2 WHERE alert_id = $3`,
              [newStatus, actor, alertId]
            );
            await client.query(
              `INSERT INTO public.nws_triage_audit (alert_id, actor, action, prev_status, new_status, note) VALUES ($1, $2, $3, $4, $5, $6)`,
              [alertId, actor, action, prevStatus, newStatus, note]
            );
            updated_alerts.push({ alert_id: alertId, triage_status: newStatus, triage_status_source: 'operator', triage_status_updated_at: new Date().toISOString() });
          }
        } catch (err) {
          failed.push({ alert_id: alertId, error: err.message });
        }
      }
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      throw e;
    } finally {
      client.release();
    }
    const updated_count = updated_alerts.length;
    if (typeof process !== 'undefined' && process.stdout) process.stdout.write('[BULK] action=triage selected=' + alertIds.length + ' success=' + updated_count + ' failed=' + failed.length + '\n');
    res.json({ updated_count, failed, updated_alerts });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /v1/deliveries/bulk — bulk queue (no send)
app.post('/v1/deliveries/bulk', async (req, res) => {
  try {
    const body = req.body || {};
    let alertIds = Array.isArray(body.alert_ids) ? body.alert_ids : [];
    alertIds = alertIds.map((id) => String(id).trim()).filter(Boolean);
    if (alertIds.length === 0) return res.status(400).json({ error: 'alert_ids required (array)' });
    if (alertIds.length > BULK_MAX) return res.status(400).json({ error: 'alert_ids exceeds BULK_MAX (' + BULK_MAX + ')' });
    const destination = body.destination || 'property_enrichment_v1';
    const mode = (body.mode || 'queue').toLowerCase();
    if (mode !== 'dry_run' && mode !== 'queue') return res.status(400).json({ error: 'mode must be dry_run or queue' });
    if (mode === 'dry_run') {
      const alerts = await getAlertsByIds(alertIds);
      const payloads = alerts.map((a) => ({ alert_id: a.alert_id, payload: buildDeliveryPayload(a, 1) }));
      return res.json({ mode: 'dry_run', count: payloads.length, payloads });
    }
    let queued_count = 0;
    let duplicates_count = 0;
    const failed = [];
    for (const alertId of alertIds) {
      try {
        const alert = await getAlertById(alertId);
        if (!alert) { failed.push({ alert_id: alertId, error: 'Alert not found' }); continue; }
        const payload = buildDeliveryPayload(alert, 1);
        const { inserted } = await enqueueDeliveryOnce({ destination, alert_id: alertId, payload_version: 1, payload }, alert.zips || []);
        if (inserted) queued_count++; else duplicates_count++;
      } catch (err) {
        failed.push({ alert_id: alertId, error: err.message });
      }
    }
    if (typeof process !== 'undefined' && process.stdout) process.stdout.write('[BULK] action=delivery selected=' + alertIds.length + ' success=' + queued_count + ' duplicates=' + duplicates_count + ' failed=' + failed.length + '\n');
    res.json({ queued_count, duplicates_count, failed });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ---------- Clients ----------
// GET /v1/clients (active only by default)
app.get('/v1/clients', async (req, res) => {
  try {
    const activeOnly = req.query.active !== 'false';
    const rows = await getClients(activeOnly);
    res.json({ clients: rows });
  } catch (e) {
    if (e.code === '42P01') return res.status(501).json({ error: 'Clients table not migrated. Run migration 016_clients_territories_thresholds.sql' });
    res.status(500).json({ error: e.message });
  }
});

// POST /v1/clients { name }
app.post('/v1/clients', async (req, res) => {
  try {
    const name = (req.body && req.body.name) ? String(req.body.name).trim() : '';
    if (!name) return res.status(400).json({ error: 'name required' });
    const client = await createClient(name);
    res.status(201).json(client);
  } catch (e) {
    if (e.code === '42P01') return res.status(501).json({ error: 'Clients table not migrated' });
    res.status(500).json({ error: e.message });
  }
});

// PATCH /v1/clients/:id { name?, is_active? }
app.patch('/v1/clients/:id', async (req, res) => {
  try {
    const id = req.params.id;
    const client = await getClientById(id);
    if (!client) return res.status(404).json({ error: 'Client not found' });
    const updated = await updateClient(id, req.body || {});
    res.json(updated);
  } catch (e) {
    if (e.code === '42P01') return res.status(501).json({ error: 'Clients table not migrated' });
    res.status(500).json({ error: e.message });
  }
});

// GET /v1/clients/:id/config
app.get('/v1/clients/:id/config', async (req, res) => {
  try {
    const configObj = await getClientConfig(req.params.id);
    if (!configObj) return res.status(404).json({ error: 'Client not found' });
    res.json(configObj);
  } catch (e) {
    if (e.code === '42P01') return res.status(501).json({ error: 'Clients table not migrated' });
    res.status(500).json({ error: e.message });
  }
});

// PUT /v1/clients/:id/config { territory?, thresholds? }
app.put('/v1/clients/:id/config', async (req, res) => {
  try {
    const configObj = await putClientConfig(req.params.id, req.body || {});
    if (!configObj) return res.status(404).json({ error: 'Client not found' });
    res.json(configObj);
  } catch (e) {
    if (e.code === '42P01') return res.status(501).json({ error: 'Clients table not migrated' });
    res.status(500).json({ error: e.message });
  }
});

// GET /v1/clients/:id/alerts — same query params as /v1/alerts, territory + client thresholds applied
app.get('/v1/clients/:id/alerts', async (req, res) => {
  try {
    const clientId = req.params.id;
    const client = await getClientById(clientId);
    if (!client) return res.status(404).json({ error: 'Client not found' });
    const active = req.query.active === 'true';
    const min_score = req.query.min_score != null ? Number(req.query.min_score) : undefined;
    const max_score = req.query.max_score != null ? Number(req.query.max_score) : undefined;
    const state = req.query.state || undefined;
    const interesting = req.query.interesting;
    const class_ = req.query.class;
    const geom_present = req.query.geom_present;
    const lsr_present = req.query.lsr_present;
    const min_zip_count = req.query.min_zip_count != null ? Number(req.query.min_zip_count) : undefined;
    const max_zip_count = req.query.max_zip_count != null ? Number(req.query.max_zip_count) : undefined;
    const max_area_sq_miles = req.query.max_area_sq_miles != null ? Number(req.query.max_area_sq_miles) : undefined;
    const sort_mode = req.query.sort_mode || (req.query.work_queue === 'true' ? 'work_queue' : undefined);
    const sort_by = req.query.sort_by || undefined;
    const sort_dir = req.query.sort_dir || undefined;
    const work_queue = req.query.work_queue === 'true';
    const triage_status = req.query.triage_status || undefined;
    const since_last_ingest = req.query.since_last_ingest !== 'false';
    let rows = await getAlertsForClient(clientId, {
      active,
      since_last_ingest,
      min_score,
      max_score,
      state,
      interesting: interesting === 'true' ? true : interesting === 'false' ? false : undefined,
      class: class_,
      geom_present: geom_present === 'true' ? true : geom_present === 'false' ? false : undefined,
      lsr_present: lsr_present === 'true' ? true : lsr_present === 'false' ? false : undefined,
      min_zip_count,
      max_zip_count,
      max_area_sq_miles,
      sort_mode,
      sort_by,
      sort_dir,
      work_queue,
      triage_status,
    });
    // Add client_relevance: HIGH / MED / LOW from interesting_any_for_client + confidence_level
    const conf = (r) => (r.confidence_level || 'low').toLowerCase();
    rows = rows.map((r) => ({
      ...r,
      client_relevance: (r.interesting_any_for_client && conf(r) === 'high') ? 'HIGH' : (r.interesting_any_for_client || conf(r) === 'high' || conf(r) === 'medium') ? 'MED' : 'LOW',
    }));
    res.json({ alerts: rows });
  } catch (e) {
    if (e.code === '42P01') return res.status(501).json({ error: 'Clients table not migrated' });
    res.status(500).json({ error: e.message });
  }
});

// GET /v1/clients/:id/queue — actionable + monitoring, Action Priority sort
app.get('/v1/clients/:id/queue', async (req, res) => {
  try {
    const clientId = req.params.id;
    const client = await getClientById(clientId);
    if (!client) return res.status(404).json({ error: 'Client not found' });
    let rows = await getAlertsForClientQueue(clientId);
    const conf = (r) => (r.confidence_level || 'low').toLowerCase();
    rows = rows.map((r) => ({
      ...r,
      client_relevance: (r.interesting_any_for_client && conf(r) === 'high') ? 'HIGH' : (r.interesting_any_for_client || conf(r) === 'high' || conf(r) === 'medium') ? 'MED' : 'LOW',
    }));
    res.json({ alerts: rows });
  } catch (e) {
    if (e.code === '42P01') return res.status(501).json({ error: 'Clients table not migrated' });
    res.status(500).json({ error: e.message });
  }
});

// GET /v1/states/:state/summary — state drilldown summary
app.get('/v1/states/:state/summary', async (req, res) => {
  try {
    const state = req.params.state;
    const summary = await getStateSummary(state);
    res.json(summary);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /v1/states/:state/alerts — same as /v1/alerts but state forced
app.get('/v1/states/:state/alerts', async (req, res) => {
  try {
    const state = req.params.state;
    const active = req.query.active === 'true';
    const min_score = req.query.min_score != null ? Number(req.query.min_score) : undefined;
    const max_score = req.query.max_score != null ? Number(req.query.max_score) : undefined;
    const interesting = req.query.interesting === 'true' ? true : req.query.interesting === 'false' ? false : undefined;
    const class_ = req.query.class;
    const geom_present = req.query.geom_present === 'true' ? true : req.query.geom_present === 'false' ? false : undefined;
    const lsr_present = req.query.lsr_present === 'true' ? true : req.query.lsr_present === 'false' ? false : undefined;
    const min_zip_count = req.query.min_zip_count != null ? Number(req.query.min_zip_count) : undefined;
    const max_zip_count = req.query.max_zip_count != null ? Number(req.query.max_zip_count) : undefined;
    const max_area_sq_miles = req.query.max_area_sq_miles != null ? Number(req.query.max_area_sq_miles) : undefined;
    const sort_mode = req.query.sort_mode;
    const sort_by = req.query.sort_by;
    const sort_dir = req.query.sort_dir;
    const rows = await getAlerts({
      state,
      active,
      min_score,
      max_score,
      interesting,
      class: class_,
      geom_present,
      lsr_present,
      min_zip_count,
      max_zip_count,
      max_area_sq_miles,
      sort_mode,
      sort_by,
      sort_dir,
    });
    res.json({ alerts: rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /v1/states/:state/places — LSR places + area_desc tokens
app.get('/v1/states/:state/places', async (req, res) => {
  try {
    const state = req.params.state;
    const data = await getStatePlaces(state);
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /v1/states/:state/outbox — outbox entries for alerts in this state
app.get('/v1/states/:state/outbox', async (req, res) => {
  try {
    const state = req.params.state;
    const limit = req.query.limit != null ? Math.min(100, parseInt(req.query.limit, 10) || 50) : 50;
    const rows = await getOutboxByState(state, limit);
    res.json({ outbox: rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /v1/map/meta — default center, radar WMS config, time extent (optional states for center)
app.get('/v1/map/meta', async (req, res) => {
  try {
    const states = req.query.states ? req.query.states.split(',').map((s) => s.trim()).filter(Boolean) : [];
    let meta = await getMapMeta(states);
    const baseUrl = (process.env.RADAR_WMS_BASE_URL || '').trim();
    if (baseUrl && process.env.RADAR_TIME_ENABLED !== 'false') {
      try {
        const fetch = (await import('undici')).fetch;
        const url = baseUrl.includes('?') ? baseUrl + '&request=GetCapabilities&SERVICE=WMS' : baseUrl + '?request=GetCapabilities&SERVICE=WMS';
        const r = await fetch(url, { signal: AbortSignal.timeout(5000) });
        const text = await r.text();
        const timeSupported = /Dimension\s+[^>]*name\s*=\s*["']time["']/i.test(text) || /<Time>/i.test(text);
        meta = { ...meta, radar_wms: { ...meta.radar_wms, time_supported: timeSupported } };
      } catch (_) {
        meta = { ...meta, radar_wms: { ...meta.radar_wms, time_supported: false } };
      }
    }
    res.json(meta);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /v1/map/alerts — GeoJSON FeatureCollection of polygons (geom_present only)
app.get('/v1/map/alerts', async (req, res) => {
  try {
    const states = req.query.states ? req.query.states.split(',').map((s) => s.trim()).filter(Boolean) : [];
    const since_hours = req.query.since_hours != null ? parseInt(req.query.since_hours, 10) : 48;
    const warnings_only = req.query.warnings_only === 'true';
    const interesting_only = req.query.interesting_only === 'true';
    const min_score = req.query.min_score != null ? parseInt(req.query.min_score, 10) : 0;
    const since_last_ingest = req.query.since_last_ingest !== 'false';
    let bbox;
    if (req.query.bbox) {
      const parts = req.query.bbox.split(',').map(Number);
      if (parts.length >= 4 && parts.every((n) => !Number.isNaN(n))) bbox = parts.slice(0, 4);
    }
    const geojson = await getMapAlerts({ states, since_hours, warnings_only, interesting_only, min_score, since_last_ingest, bbox });
    res.json(geojson);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /v1/map/zips — GeoJSON FeatureCollection of ZIP centroid points
app.get('/v1/map/zips', async (req, res) => {
  try {
    const states = req.query.states ? req.query.states.split(',').map((s) => s.trim()).filter(Boolean) : [];
    const since_hours = req.query.since_hours != null ? parseInt(req.query.since_hours, 10) : 48;
    const warnings_only = req.query.warnings_only === 'true';
    const interesting_only = req.query.interesting_only === 'true';
    const min_score = req.query.min_score != null ? parseInt(req.query.min_score, 10) : 0;
    const since_last_ingest = req.query.since_last_ingest !== 'false';
    let bbox;
    if (req.query.bbox) {
      const parts = req.query.bbox.split(',').map(Number);
      if (parts.length >= 4 && parts.every((n) => !Number.isNaN(n))) bbox = parts.slice(0, 4);
    }
    const prefer_polygons = req.query.prefer_polygons === 'true';
    const geojson = await getMapZips({ states, since_hours, warnings_only, interesting_only, min_score, since_last_ingest, bbox, prefer_polygons });
    res.json(geojson);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /v1/alerts/:alert_id — includes description and instruction from NWS raw_json when available
app.get('/v1/alerts/:alert_id', async (req, res) => {
  try {
    const alert = await getAlertById(req.params.alert_id);
    if (!alert) return res.status(404).json({ error: 'Alert not found' });
    let description = null;
    let instruction = null;
    try {
      const st = await getAlertNwsStatement(req.params.alert_id);
      description = st.description;
      instruction = st.instruction;
    } catch (_) { /* nws_alerts may be missing or no raw_json */ }
    res.json({ ...alert, description, instruction });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /v1/alerts/:alert_id/triage — operator triage actions
// Body: { action: "set_actionable"|"set_monitoring"|"set_suppressed"|"set_sent_manual"|"reset_to_system", note?: string }
app.post('/v1/alerts/:alert_id/triage', async (req, res) => {
  try {
    const alertId = req.params.alert_id;
    const alert = await getAlertById(alertId);
    if (!alert) return res.status(404).json({ error: 'Alert not found' });

    const body = req.body || {};
    const action = body.action && String(body.action).toLowerCase();
    if (!action || !TRIAGE_ACTIONS.has(action)) {
      return res.status(400).json({ error: 'action required: set_actionable, set_monitoring, set_suppressed, set_sent_manual, or reset_to_system' });
    }

    const prevStatus = alert.triage_status || 'new';
    const actor = req.user && (req.user.email || req.user.id);

    if (action === 'reset_to_system') {
      const { status, reasons, confidence_level } = computeTriage(alert);
      await updateAlertTriage(alertId, {
        triage_status: status,
        triage_status_source: 'system',
        triage_reasons: reasons,
        confidence_level,
        triage_status_updated_by: null,
      });
      await insertTriageAudit(alertId, actor, action, prevStatus, status, body.note);
      const updated = await getAlertById(alertId);
      return res.json({
        triage_status: updated.triage_status,
        triage_status_source: updated.triage_status_source,
        triage_reasons: updated.triage_reasons || [],
        confidence_level: updated.confidence_level,
        triage_status_updated_at: updated.triage_status_updated_at,
        triage_status_updated_by: updated.triage_status_updated_by,
      });
    }

    const newStatus = actionToStatus(action);
    if (!newStatus) return res.status(400).json({ error: 'Invalid action' });

    await updateAlertTriage(alertId, {
      triage_status: newStatus,
      triage_status_source: 'operator',
      triage_status_updated_by: actor,
    });
    await insertTriageAudit(alertId, actor, action, prevStatus, newStatus, body.note);

    const updated = await getAlertById(alertId);
    res.json({
      triage_status: updated.triage_status,
      triage_status_source: updated.triage_status_source,
      triage_reasons: updated.triage_reasons || [],
      confidence_level: updated.confidence_level,
      triage_status_updated_at: updated.triage_status_updated_at,
      triage_status_updated_by: updated.triage_status_updated_by,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /v1/alerts/:alert_id/audit — last 20 triage audit entries
app.get('/v1/alerts/:alert_id/audit', async (req, res) => {
  try {
    const alert = await getAlertById(req.params.alert_id);
    if (!alert) return res.status(404).json({ error: 'Alert not found' });
    const limit = Math.min(50, parseInt(req.query.limit, 10) || 20);
    const rows = await getTriageAudit(req.params.alert_id, limit);
    res.json({ audit: rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /v1/alerts/:alert_id/lsr-recheck — run LSR matching for this alert only, return updated alert
app.post('/v1/alerts/:alert_id/lsr-recheck', async (req, res) => {
  try {
    const alertId = req.params.alert_id;
    const alert = await getAlertById(alertId);
    if (!alert) return res.status(404).json({ error: 'Alert not found' });
    await runLsrRecheckForAlert(alertId);
    const updated = await getAlertById(alertId);
    if (updated && (updated.triage_status_source || 'system') === 'system') {
      const { status, reasons, confidence_level } = computeTriage(updated);
      await updateAlertTriage(alertId, { triage_status: status, triage_status_source: 'system', triage_reasons: reasons, confidence_level });
    }
    const out = await getAlertById(alertId);
    return res.json(out);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /v1/alerts/:alert_id/zips.csv
app.get('/v1/alerts/:alert_id/zips.csv', async (req, res) => {
  try {
    const alert = await getAlertById(req.params.alert_id);
    if (!alert) return res.status(404).json({ error: 'Alert not found' });
    const zips = alert.zips || [];
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="alert-${req.params.alert_id}-zips.csv"`);
    res.send('zip\n' + zips.join('\n'));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /v1/alerts/:alert_id/payload?destination=property_enrichment_v1
app.get('/v1/alerts/:alert_id/payload', async (req, res) => {
  try {
    const alert = await getAlertById(req.params.alert_id);
    if (!alert) return res.status(404).json({ error: 'Alert not found' });
    const version = parseInt(req.query.payload_version, 10) || 1;
    const payload = buildDeliveryPayload(alert, version);
    res.json({ destination: req.query.destination || 'default', payload_version: version, payload });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /v1/deliveries { alert_id, destination, payload_version=1, mode: "dry_run"|"queue"|"send_now" }
app.post('/v1/deliveries', async (req, res) => {
  try {
    const { alert_id, destination, payload_version = 1, mode = 'queue' } = req.body || {};
    if (!alert_id || !destination) return res.status(400).json({ error: 'alert_id and destination required' });
    const alert = await getAlertById(alert_id);
    if (!alert) return res.status(404).json({ error: 'Alert not found' });
    const payload = buildDeliveryPayload(alert, payload_version);
    const event_key = payload.event_key;

    if (mode === 'dry_run') {
      return res.json({ mode: 'dry_run', event_key, payload });
    }

    if (mode === 'queue') {
      const row = await enqueueDelivery(
        { destination, alert_id, payload_version, payload },
        alert.zips || []
      );
      return res.status(201).json({ mode: 'queue', event_key, id: row.id, status: row.status });
    }

    if (mode === 'send_now') {
      const row = await enqueueDelivery(
        { destination, alert_id, payload_version, payload },
        alert.zips || []
      );
      // Worker would pick it up; for sync "send_now" we could call the adapter here. Spec says worker does send. So we just queue and return.
      return res.status(201).json({ mode: 'send_now', event_key, id: row.id, status: row.status });
    }

    return res.status(400).json({ error: 'Invalid mode' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /v1/outbox?status=queued|failed|sent
app.get('/v1/outbox', async (req, res) => {
  try {
    const status = req.query.status || undefined;
    const limit = Math.min(100, parseInt(req.query.limit, 10) || 50);
    const rows = await getOutbox(status, limit);
    res.json({ outbox: rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /v1/outbox/:id/retry
app.post('/v1/outbox/:id/retry', async (req, res) => {
  try {
    const row = await getOutboxById(req.params.id);
    if (!row) return res.status(404).json({ error: 'Outbox row not found' });
    if (row.status === 'sent') return res.status(400).json({ error: 'Already sent' });
    await updateOutboxRow(row.id, { status: 'queued' });
    const updated = await getOutboxById(req.params.id);
    res.json(updated);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /v1/outbox/:id/cancel
app.post('/v1/outbox/:id/cancel', async (req, res) => {
  try {
    const row = await getOutboxById(req.params.id);
    if (!row) return res.status(404).json({ error: 'Outbox row not found' });
    await cancelOutboxRow(row.id);
    const updated = await getOutboxById(req.params.id);
    res.json(updated);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.listen(PORT, () => {
  console.log('AI-STORMS API listening on port', PORT);
});
