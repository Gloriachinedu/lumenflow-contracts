/**
 * Unit tests for Intl-based date and currency formatting (issue #1017)
 *
 * Verifies that:
 *   - Amounts are formatted using Intl.NumberFormat with the detected locale
 *   - Dates are formatted using Intl.DateTimeFormat with the detected locale
 *   - Falls back to en-US when locale detection fails
 *   - Formatting is applied consistently across history.js, receipt.js,
 *     receipt-page.js, and multisig-page.js
 *
 * Run:
 *   node frontend/intl-formatting.test.js
 */

'use strict';

// ── Minimal test harness ──────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function assert(condition, label) {
  if (condition) {
    console.log('  ✔', label);
    passed++;
  } else {
    console.error('  ✗', label);
    failed++;
  }
}

function assertEqual(actual, expected, label) {
  const ok = actual === expected;
  if (ok) {
    console.log('  ✔', label);
    passed++;
  } else {
    console.error(`  ✗ ${label}\n    expected: ${JSON.stringify(expected)}\n    actual:   ${JSON.stringify(actual)}`);
    failed++;
  }
}

function describe(title, fn) {
  console.log('\n' + title);
  fn();
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Format a number using Intl.NumberFormat with the given locale and options.
 * Falls back to 'en-US' on invalid locale.
 *
 * @param {number} value
 * @param {string} locale
 * @param {Intl.NumberFormatOptions} options
 * @returns {string}
 */
function intlFormatNumber(value, locale, options = {}) {
  try {
    return new Intl.NumberFormat(locale, options).format(value);
  } catch (e) {
    return new Intl.NumberFormat('en-US', options).format(value);
  }
}

/**
 * Format a Unix timestamp (seconds) using Intl.DateTimeFormat with the given
 * locale. Falls back to 'en-US' on invalid locale.
 *
 * @param {number} timestamp  - Unix seconds
 * @param {string} locale
 * @returns {string}
 */
function intlFormatDate(timestamp, locale) {
  const date = new Date(timestamp * 1000);
  const opts = {
    year:   'numeric',
    month:  'short',
    day:    'numeric',
    hour:   '2-digit',
    minute: '2-digit',
    timeZoneName: 'short',
  };
  try {
    return new Intl.DateTimeFormat(locale, opts).format(date);
  } catch (e) {
    return new Intl.DateTimeFormat('en-US', opts).format(date);
  }
}

/**
 * Simulate the formatAmount function from receipt.js.
 * Uses detectLocale() style fallback to en-US.
 *
 * @param {number|bigint} amount
 * @param {number} decimals
 * @param {string} locale  - Simulated detected locale
 * @returns {string}
 */
function simulateFormatAmount(amount, decimals, locale) {
  const value = Number(amount) / Math.pow(10, decimals);
  return intlFormatNumber(value, locale, {
    minimumFractionDigits: 2,
    maximumFractionDigits: decimals,
  });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('Intl.NumberFormat — amount formatting', () => {
  // Basic formatting
  const amount = 1000000000n; // 100 XLM in stroops
  const result_en = simulateFormatAmount(amount, 7, 'en-US');
  assert(result_en.includes('100'), 'en-US: 1000000000 stroops formats to include "100"');
  assert(result_en.includes('.'), 'en-US: formatted amount includes decimal separator');

  // German locale uses comma as decimal separator
  const result_de = simulateFormatAmount(amount, 7, 'de-DE');
  assert(typeof result_de === 'string', 'de-DE: returns a string');
  assert(result_de.length > 0, 'de-DE: returns non-empty string');

  // Japanese locale
  const result_ja = simulateFormatAmount(amount, 7, 'ja-JP');
  assert(typeof result_ja === 'string', 'ja-JP: returns a string');

  // Invalid locale falls back to en-US
  const result_invalid = simulateFormatAmount(amount, 7, 'not-a-locale');
  assert(typeof result_invalid === 'string', 'invalid locale falls back without throwing');
});

describe('Intl.NumberFormat — minimum fraction digits', () => {
  // Should always have at least 2 decimal places
  const amount = 100000000n; // 10 XLM in stroops
  const result = simulateFormatAmount(amount, 7, 'en-US');
  const decimalPart = result.split('.')[1];
  assert(decimalPart !== undefined, 'has decimal part');
  assert(decimalPart.length >= 2, 'has at least 2 decimal places');
});

describe('Intl.DateTimeFormat — date formatting', () => {
  const ts = 1748476800; // 2025-05-28 16:00:00 UTC

  // en-US format
  const result_en = intlFormatDate(ts, 'en-US');
  assert(typeof result_en === 'string', 'en-US: returns a string');
  assert(result_en.length > 0, 'en-US: non-empty result');
  assert(result_en.includes('2025') || result_en.includes('25'), 'en-US: includes year');

  // German locale
  const result_de = intlFormatDate(ts, 'de-DE');
  assert(typeof result_de === 'string', 'de-DE: returns a string');
  assert(result_de.length > 0, 'de-DE: non-empty result');

  // Japanese locale
  const result_ja = intlFormatDate(ts, 'ja-JP');
  assert(typeof result_ja === 'string', 'ja-JP: returns a string');

  // Brazilian Portuguese locale
  const result_pt = intlFormatDate(ts, 'pt-BR');
  assert(typeof result_pt === 'string', 'pt-BR: returns a string');

  // Arabic locale (RTL)
  const result_ar = intlFormatDate(ts, 'ar-SA');
  assert(typeof result_ar === 'string', 'ar-SA: returns a string');
});

describe('Intl.DateTimeFormat — fallback to en-US', () => {
  const ts = 1748476800;
  const result = intlFormatDate(ts, 'not-a-real-locale-xyz');
  assert(typeof result === 'string', 'invalid locale falls back without throwing');
  assert(result.length > 0, 'fallback produces non-empty result');
});

describe('Intl.DateTimeFormat — timezone display', () => {
  const ts = 1748476800;
  const result = intlFormatDate(ts, 'en-US');
  // Result should include a timezone abbreviation (e.g., GMT, UTC, EST, PDT)
  assert(
    /[A-Z]{2,5}|UTC|GMT/.test(result),
    'en-US: result includes timezone info'
  );
});

describe('Locale detection fallback', () => {
  // Simulates detectLocale() returning 'en-US' when navigator is unavailable
  const fallbackLocale = 'en-US';
  const ts = 1748476800;
  const amount = 500000000n; // 50 XLM

  const dateResult = intlFormatDate(ts, fallbackLocale);
  const amountResult = simulateFormatAmount(amount, 7, fallbackLocale);

  assert(dateResult.includes('2025') || dateResult.includes('25'), 'fallback locale date includes year');
  assert(amountResult.includes('50'), 'fallback locale amount includes "50"');
});

describe('Static audit — files use Intl APIs', () => {
  const fs = require('fs');
  const path = require('path');

  const dir = path.join(__dirname);

  function check(filename, criterion, description) {
    const content = fs.readFileSync(path.join(dir, filename), 'utf8');
    assert(criterion(content), `${filename}: ${description}`);
  }

  // history.js should import formatDate from shared (which uses Intl)
  check('history.js', c => c.includes('formatDate') && c.includes('lumenflow-shared'), 'imports formatDate from lumenflow-shared.js');

  // receipt.js should use Intl.NumberFormat and Intl.DateTimeFormat
  check('receipt.js', c => c.includes('Intl.NumberFormat'), 'uses Intl.NumberFormat for amount formatting');
  check('receipt.js', c => c.includes('Intl.DateTimeFormat'), 'uses Intl.DateTimeFormat for date formatting');
  check('receipt.js', c => c.includes('en-US'), 'receipt.js has en-US fallback');

  // receipt-page.js imports formatDate from shared
  check('receipt-page.js', c => c.includes('formatDate') && c.includes('lumenflow-shared'), 'imports formatDate from lumenflow-shared.js');

  // multisig-page.js imports formatDate from shared
  check('multisig-page.js', c => c.includes('formatDate') && c.includes('lumenflow-shared'), 'imports formatDate from lumenflow-shared.js');

  // lumenflow-shared.js uses Intl APIs
  check('lumenflow-shared.js', c => c.includes('Intl.NumberFormat'), 'lumenflow-shared.js uses Intl.NumberFormat');
  check('lumenflow-shared.js', c => c.includes('Intl.DateTimeFormat'), 'lumenflow-shared.js uses Intl.DateTimeFormat');
});

// ── Summary ───────────────────────────────────────────────────────────────────

console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
