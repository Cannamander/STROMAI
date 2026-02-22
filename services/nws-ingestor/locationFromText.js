'use strict';
/**
 * Extract place names from NWS headline/description/instruction/area_desc
 * so we can geocode them and narrow UGC-derived ZIPs to a more precise set.
 * Uses phrase-based patterns to avoid false positives.
 */

/**
 * Normalize text: single line, collapse whitespace.
 * @param {string} s
 * @returns {string}
 */
function normalizeText(s) {
  if (s == null || typeof s !== 'string') return '';
  return s.replace(/\s+/g, ' ').trim();
}

/**
 * Split "A, B, and C" or "A and B" into trimmed tokens (handles "and" as separator).
 * @param {string} listStr
 * @returns {string[]}
 */
function splitList(listStr) {
  if (!listStr || typeof listStr !== 'string') return [];
  return listStr
    .split(/\s*,\s*|\s+and\s+/i)
    .map((t) => t.trim().replace(/^\s*and\s+/i, '').trim())
    .filter((t) => t.length > 0 && t.length < 80 && !/^(including|the|of|for|in|near|through)$/i.test(t));
}

/**
 * Extract place names from a single phrase following a known prefix.
 * E.g. "Including the cities of Dallas, Rockwall, and Garland" -> ["Dallas", "Rockwall", "Garland"]
 * Stops at common sentence endings or next major clause.
 * @param {string} text - full text
 * @param {RegExp} prefix - pattern whose match ends where the list starts
 * @returns {string[]}
 */
function extractListAfter(text, prefix) {
  const m = text.match(prefix);
  if (!m) return [];
  const start = m.index + m[0].length;
  let tail = text.slice(start);
  // Stop at period, newline, or "... For " (next section)
  const endMatch = tail.match(/\s*\.\s*|\n|\.\.\.\s+For\s+|\s+For\s+[A-Z]/);
  if (endMatch) tail = tail.slice(0, endMatch.index);
  return splitList(tail);
}

const CITIES_OF_RE = /\b(?:including\s+)?(?:the\s+)?cities\s+of\s+/i;
const NEAR_RE = /\bnear\s+([^.!\n]+?)(?=\s*[.!]|\s+For\s+|\n|$)/gi;
const INCLUDING_LIST_RE = /\bincluding\s+([A-Za-z][^.!?\n]{2,60}?(?:,\s*[A-Za-z]|\s+and\s+[A-Za-z]))/g;

const PLACE_PATTERNS = [
  { re: CITIES_OF_RE, extract: (t) => extractListAfter(t, CITIES_OF_RE) },
  {
    re: /\bnear\s+/i,
    extract: (t) => {
      const out = [];
      const re = new RegExp(NEAR_RE.source, 'gi');
      let m;
      while ((m = re.exec(t)) !== null) {
        splitList(m[1]).forEach((s) => out.push(s));
      }
      return out;
    },
  },
  {
    re: /\bincluding\s+[A-Za-z]/i,
    extract: (t) => {
      const out = [];
      const re = new RegExp(INCLUDING_LIST_RE.source, 'g');
      let m;
      while ((m = re.exec(t)) !== null) {
        splitList(m[1]).forEach((s) => out.push(s));
      }
      return out;
    },
  },
];

/**
 * Extract place names from combined NWS text (headline, description, instruction, area_desc).
 * Returns unique, trimmed names (2–80 chars) suitable for geocoding.
 * @param {{ headline?: string, description?: string, instruction?: string, area_desc?: string }} opts
 * @returns {string[]}
 */
function extractPlaceNames(opts = {}) {
  const combined = [
    opts.headline,
    opts.description,
    opts.instruction,
    opts.area_desc,
  ]
    .filter(Boolean)
    .map(normalizeText)
    .join(' ');
  const text = normalizeText(combined);
  if (!text) return [];

  const seen = new Set();
  const out = [];

  for (const { re, extract } of PLACE_PATTERNS) {
    if (!re.test(text)) continue;
    const list = extract(text);
    for (const name of list) {
      const n = name.trim();
      if (n.length >= 2 && n.length <= 80 && !seen.has(n.toLowerCase())) {
        seen.add(n.toLowerCase());
        out.push(n);
      }
    }
  }

  return out;
}

module.exports = {
  extractPlaceNames,
  splitList,
  normalizeText,
};
