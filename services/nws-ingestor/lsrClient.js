'use strict';
const { fetch } = require('undici');
const config = require('./config');

const headers = {
  'User-Agent': config.nwsUserAgent,
  Accept: 'application/ld+json, application/json',
};

/**
 * List LSR product IDs from NWS products API (type=LSR), filtered by lookback window.
 * @returns {Promise<Array<{ id: string, issuanceTime: string }>>}
 */
async function listLsrProductIds() {
  const url = `${config.nwsBaseUrl}/products/types/LSR`;
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`NWS products list: ${res.status}`);
  const data = await res.json();
  const graph = data['@graph'] || [];
  const cutoff = new Date(Date.now() - config.lsrLookbackHours * 60 * 60 * 1000);
  return graph
    .filter((p) => p.issuanceTime && new Date(p.issuanceTime) >= cutoff)
    .map((p) => ({ id: p.id || p['@id']?.split('/').pop(), issuanceTime: p.issuanceTime }));
}

/**
 * Fetch one product by ID; returns { productId, issuanceTime, productText }.
 */
async function fetchProduct(productId) {
  const url = `${config.nwsBaseUrl}/products/${productId}`;
  const res = await fetch(url, { headers });
  if (!res.ok) return null;
  const data = await res.json();
  return {
    productId: data.id || productId,
    issuanceTime: data.issuanceTime || null,
    productText: data.productText ?? '',
  };
}

/**
 * Fetch recent LSR products (list then fetch each body). Does not throw on individual fetch failure.
 * @returns {Promise<Array<{ productId: string, issuanceTime: string|null, productText: string }>>}
 */
async function fetchRecentLsrProducts() {
  const list = await listLsrProductIds();
  const out = [];
  for (const { id, issuanceTime } of list) {
    try {
      const product = await fetchProduct(id);
      if (product && (product.productText || '').trim()) out.push({ ...product, issuanceTime: product.issuanceTime || issuanceTime });
    } catch (_) {
      // skip failed product fetch
    }
  }
  return out;
}

module.exports = { listLsrProductIds, fetchProduct, fetchRecentLsrProducts };
