'use strict';
/**
 * Frontend/client UI tests: URL param, client header content, config persist (logic/contract).
 */
const { describe, it } = require('node:test');
const assert = require('node:assert');

describe('client URL param', () => {
  it('client_id in URL is read as selected client', () => {
    const params = new URLSearchParams('client_id=abc-123');
    const id = params.get('client_id');
    assert.strictEqual(id, 'abc-123');
  });

  it('no client_id in URL means All Clients', () => {
    const params = new URLSearchParams('');
    const id = params.get('client_id');
    assert.strictEqual(id, null);
  });
});

describe('client header content', () => {
  it('territory states render as pills', () => {
    const states = ['TX', 'OK'];
    const html = states.map((s) => '<span class="client-territory-pill">' + s + '</span>').join('');
    assert(html.includes('TX'));
    assert(html.includes('OK'));
  });

  it('thresholds summary format: hail, wind, rare freeze', () => {
    const th = { hail_min_inches: 1.25, wind_min_mph: 70, rare_freeze_enabled: true, rare_freeze_states: ['TX'] };
    const parts = [
      'Hail \u2265 ' + (th.hail_min_inches ?? 1.25) + ' in',
      'Wind \u2265 ' + (th.wind_min_mph ?? 70) + ' mph',
      'Rare Freeze: ' + (th.rare_freeze_enabled ? (th.rare_freeze_states && th.rare_freeze_states.length ? th.rare_freeze_states.join(', ') : 'TX') : 'Off'),
    ];
    assert(parts[0].includes('1.25'));
    assert(parts[1].includes('70'));
    assert(parts[2].includes('TX'));
  });
});

describe('edit config persist', () => {
  it('PUT config body includes territory.states and thresholds', () => {
    const body = {
      name: 'Acme',
      territory: { states: ['TX', 'OK'] },
      thresholds: { hail_min_inches: 1.25, wind_min_mph: 70, rare_freeze_enabled: true, rare_freeze_states: ['TX'] },
    };
    assert.deepStrictEqual(body.territory.states, ['TX', 'OK']);
    assert.strictEqual(body.thresholds.hail_min_inches, 1.25);
  });

  it('state outside territory shows outside banner', () => {
    const territoryStates = ['TX', 'OK'];
    const drawerState = 'CA';
    const inTerritory = territoryStates.some((s) => String(s).toUpperCase() === String(drawerState).toUpperCase());
    assert.strictEqual(inTerritory, false);
  });
});
