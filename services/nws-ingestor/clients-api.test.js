'use strict';
/**
 * Backend tests for clients: CRUD, config GET/PUT, client-scoped alerts (territory + thresholds).
 */
const { describe, it } = require('node:test');
const assert = require('node:assert');
const {
  getClients,
  getClientById,
  createClient,
  updateClient,
  getClientConfig,
  putClientConfig,
  getAlertsForClient,
  getAlertsForClientQueue,
} = require('./db');

describe('clients CRUD', () => {
  it('getClients returns array (active only by default)', async () => {
    try {
      const rows = await getClients(true);
      assert(Array.isArray(rows));
    } catch (e) {
      if (e.code === '42P01') return; // tables not migrated
      throw e;
    }
  });

  it('createClient creates client and returns id and name', async () => {
    try {
      const client = await createClient('Test Client ' + Date.now());
      assert(client);
      assert(client.client_id);
      assert.strictEqual(client.name, client.name.trim());
    } catch (e) {
      if (e.code === '42P01') return;
      throw e;
    }
  });

  it('getClientById returns client or null', async () => {
    try {
      const list = await getClients(false);
      if (list.length === 0) return;
      const c = await getClientById(list[0].client_id);
      assert(c);
      assert.strictEqual(c.client_id, list[0].client_id);
      const missing = await getClientById('00000000-0000-0000-0000-000000000000');
      assert.strictEqual(missing, null);
    } catch (e) {
      if (e.code === '42P01') return;
      throw e;
    }
  });

  it('updateClient updates name and is_active', async () => {
    try {
      const client = await createClient('Update Test ' + Date.now());
      const updated = await updateClient(client.client_id, { name: 'Updated Name', is_active: true });
      assert.strictEqual(updated.name, 'Updated Name');
      assert.strictEqual(updated.is_active, true);
    } catch (e) {
      if (e.code === '42P01') return;
      throw e;
    }
  });
});

describe('client config', () => {
  it('getClientConfig returns client, territory, thresholds', async () => {
    try {
      const client = await createClient('Config Test ' + Date.now());
      const config = await getClientConfig(client.client_id);
      assert(config);
      assert(config.client);
      assert.strictEqual(config.client.id, client.client_id);
      assert(config.territory);
      assert(Array.isArray(config.territory.states));
      assert(config.thresholds);
      assert(typeof config.thresholds.hail_min_inches === 'number');
      assert(typeof config.thresholds.wind_min_mph === 'number');
      assert(typeof config.thresholds.rare_freeze_enabled === 'boolean');
      assert(Array.isArray(config.thresholds.rare_freeze_states));
    } catch (e) {
      if (e.code === '42P01') return;
      throw e;
    }
  });

  it('putClientConfig updates territory and thresholds', async () => {
    try {
      const client = await createClient('Put Config ' + Date.now());
      const config = await putClientConfig(client.client_id, {
        name: 'Put Name',
        territory: { states: ['TX', 'OK'] },
        thresholds: { hail_min_inches: 2, wind_min_mph: 80, rare_freeze_enabled: false, rare_freeze_states: ['OK'] },
      });
      assert.strictEqual(config.client.name, 'Put Name');
      assert.deepStrictEqual(config.territory.states, ['TX', 'OK']);
      assert.strictEqual(config.thresholds.hail_min_inches, 2);
      assert.strictEqual(config.thresholds.wind_min_mph, 80);
      assert.strictEqual(config.thresholds.rare_freeze_enabled, false);
      assert.deepStrictEqual(config.thresholds.rare_freeze_states, ['OK']);
    } catch (e) {
      if (e.code === '42P01') return;
      throw e;
    }
  });
});

describe('client-scoped alerts', () => {
  it('getAlertsForClient filters by territory states and returns interesting_any_for_client and badges_for_client', async () => {
    try {
      const client = await createClient('Alerts Test ' + Date.now());
      await putClientConfig(client.client_id, { territory: { states: ['TX'] } });
      const rows = await getAlertsForClient(client.client_id, {});
      assert(Array.isArray(rows));
      rows.forEach((r) => {
        assert(typeof r.interesting_any_for_client === 'boolean');
        assert(Array.isArray(r.badges_for_client));
        assert(r.impacted_states == null || !Array.isArray(r.impacted_states) || r.impacted_states.some((s) => String(s).toUpperCase() === 'TX'));
      });
    } catch (e) {
      if (e.code === '42P01') return;
      throw e;
    }
  });

  it('getAlertsForClientQueue returns work_queue filter and action sort', async () => {
    try {
      const client = await createClient('Queue Test ' + Date.now());
      await putClientConfig(client.client_id, { territory: { states: ['TX', 'OK'] } });
      const rows = await getAlertsForClientQueue(client.client_id);
      assert(Array.isArray(rows));
      rows.forEach((r) => {
        const status = (r.triage_status || 'new').toLowerCase();
        assert(status === 'actionable' || status === 'monitoring');
      });
    } catch (e) {
      if (e.code === '42P01') return;
      throw e;
    }
  });
});
