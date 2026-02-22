'use strict';
/**
 * Parse NWS description/headline/instruction text to extract signals for scoring when LSR is 0.
 * Returns hail_inches, wind_mph, damage_keyword_count for use in damage_score and interesting flags.
 */
const config = require('./config');

const HAIL_THRESHOLD = config.interestingHailInches ?? 1.25;
const WIND_THRESHOLD = config.interestingWindMph ?? 70;

// Hail: size names → approximate inches (run first)
const HAIL_SIZE_NAMES = [
  { pattern: /\b(quarter|pea)\s*(?:size|sized)?\b/i, inches: 1 },
  { pattern: /\b(penny|dime|mothball)\s*(?:size|sized)?\b/i, inches: 0.75 },
  { pattern: /\bnickel\s*(?:size|sized)?\b/i, inches: 0.88 },
  { pattern: /\bhalf\s*dollar\b/i, inches: 1.25 },
  { pattern: /\b(quarter[\s-]?sized|1\s*inch|1\.0\s*in)\b/i, inches: 1 },
  { pattern: /\b1\.25\s*(?:inch|in\.?)\b/i, inches: 1.25 },
  { pattern: /\b1\.5\s*(?:inch|in\.?)|1\s*1\/2\s*inch\b/i, inches: 1.5 },
  { pattern: /\bgolf\s*ball\b/i, inches: 1.75 },
  { pattern: /\b(hen\s*egg|2\s*inch|2\.0\s*in)\b/i, inches: 2 },
  { pattern: /\btennis\s*ball\b/i, inches: 2.5 },
  { pattern: /\bbaseball\b/i, inches: 2.75 },
  { pattern: /\b(3\s*inch|3\.0\s*in)\b/i, inches: 3 },
];
// Numeric hail: X inch(es) - run after named
const HAIL_NUMERIC = /\b(\d+\.?\d*)\s*(?:inch|in\.?)\s*(?:hail|diameter)?/gi;

// Wind: "X mph", "winds to X", "X mile per hour", "X-mile per hour"
const WIND_PATTERN = /\b(?:winds?\s+(?:to\s+)?|gusts?\s+(?:to\s+)?|up\s+to\s+)?(\d{2,3})\s*(?:mph|mile(?:\s*per\s*hour)?|miles?\s*per\s*hour)\b/gi;

// Damage/observed language: boosts score when LSR is 0
const DAMAGE_PATTERN = /\b(damage|damaged|destroyed|destruction|trees?\s+down|power\s+lines?\s+down|roof|structural|flood|injury|injuries|reported|confirmed|observed|spotter\s+report|law\s+enforcement\s+report)\b/gi;

/**
 * Extract best hail size (inches) from text. Returns null if none found.
 * @param {string} text
 * @returns {number|null}
 */
function parseHailFromText(text) {
  if (!text || typeof text !== 'string') return null;
  const t = text.replace(/\s+/g, ' ');
  let best = null;
  for (const { pattern, inches } of HAIL_SIZE_NAMES) {
    const re = new RegExp(pattern.source, pattern.flags || 'i');
    if (re.test(t) && (best == null || inches > best)) best = inches;
  }
  const numRegex = new RegExp(HAIL_NUMERIC.source, 'gi');
  let m;
  let count = 0;
  while (count < 20 && (m = numRegex.exec(t)) !== null) {
    count++;
    const val = parseFloat(String(m[1]).replace(',', '.'));
    if (!Number.isNaN(val) && (best == null || val > best)) best = val;
  }
  return best;
}

/**
 * Extract best wind speed (mph) from text. Returns null if none found.
 * @param {string} text
 * @returns {number|null}
 */
function parseWindFromText(text) {
  if (!text || typeof text !== 'string') return null;
  const regex = new RegExp(WIND_PATTERN.source, 'gi');
  let best = null;
  let m;
  while ((m = regex.exec(text)) !== null) {
    const val = parseInt(m[1], 10);
    if (!Number.isNaN(val) && (best == null || val > best)) best = val;
  }
  return best;
}

/**
 * Count damage/observed keyword matches in text.
 * @param {string} text
 * @returns {number}
 */
function countDamageKeywords(text) {
  if (!text || typeof text !== 'string') return 0;
  const matches = text.match(DAMAGE_PATTERN);
  return matches ? matches.length : 0;
}

/**
 * Combine headline, description, instruction and extract all signals.
 * @param {object} opts - { headline?, description?, instruction? }
 * @returns {{ hail_inches: number|null, wind_mph: number|null, damage_keyword_count: number }}
 */
function extractSignalsFromText(opts = {}) {
  const parts = [
    opts.headline,
    opts.description,
    opts.instruction,
  ].filter(Boolean).map((s) => String(s).trim());
  const combined = parts.join(' ');
  const hail_inches = parseHailFromText(combined);
  const wind_mph = parseWindFromText(combined);
  const damage_keyword_count = countDamageKeywords(combined);
  return {
    hail_inches: hail_inches != null ? hail_inches : null,
    wind_mph: wind_mph != null ? wind_mph : null,
    damage_keyword_count,
  };
}

module.exports = {
  extractSignalsFromText,
  parseHailFromText,
  parseWindFromText,
  countDamageKeywords,
  HAIL_THRESHOLD,
  WIND_THRESHOLD,
};
