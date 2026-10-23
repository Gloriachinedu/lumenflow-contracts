/**
 * Tests for standardized form validation timing and inline error placement (issue #794).
 *
 * Covers:
 *   - setFieldError() syncs aria-invalid, .error class, and error text
 *   - Per-field validators return correct boolean results
 *   - Errors are linked to inputs via aria-describedby
 *   - Error messages have role="alert" / aria-live for screen reader announcements
 *   - Blur listeners are wired for inline feedback timing
 *   - validateForm() focuses the first invalid field
 *
 * Run with Node.js (no test framework required):
 *   node frontend/form-validation.test.js
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

// ── Static audit helpers ──────────────────────────────────────────────────────

const fs   = require('fs');
const path = require('path');

function readFile(name) {
  return fs.readFileSync(path.join(__dirname, name), 'utf8');
}

function count(str, pattern) {
  return (str.match(pattern) || []).length;
}

// ── Node-side unit tests for validation logic ─────────────────────────────────

/**
 * Extract the isValidStellarKey function from multisig.html source and eval it.
 */
function extractAndEvalFunction(html, fnName) {
  // Grab from the first occurrence of `function <name>` to the matching closing brace.
  const start = html.indexOf(`function ${fnName}`);
  if (start === -1) throw new Error(`Function ${fnName} not found`);
  let depth = 0;
  let i = start;
  while (i < html.length) {
    if (html[i] === '{') depth++;
    if (html[i] === '}') { depth--; if (depth === 0) { i++; break; } }
    i++;
  }
  const src = html.slice(start, i);
  return eval(`(${src})`); // eslint-disable-line no-eval
}

const html = readFile('multisig.html');

// Extract the regex constant and the function
const STELLAR_KEY_BODY = /^[A-Z2-7]{55}$/;
const isValidStellarKey = extractAndEvalFunction(html, 'isValidStellarKey');

describe('isValidStellarKey – valid keys', () => {
  // 56-char G address (G + 55 base32 upper chars)
  const validG = 'G' + 'A'.repeat(55);
  const validC = 'C' + 'A'.repeat(55);

  assert(isValidStellarKey(validG, ['G']),        'valid G-key accepted for G prefix');
  assert(isValidStellarKey(validC, ['C', 'G']),   'valid C-key accepted for C|G prefixes');
  assert(!isValidStellarKey(validG, ['C']),        'G-key rejected when only C prefix allowed');
});

describe('isValidStellarKey – invalid keys', () => {
  assert(!isValidStellarKey('', ['G']),                       'empty string rejected');
  assert(!isValidStellarKey('G' + 'A'.repeat(54), ['G']),    '55-char key rejected (too short)');
  assert(!isValidStellarKey('G' + 'A'.repeat(56), ['G']),    '57-char key rejected (too long)');
  assert(!isValidStellarKey('G' + 'a'.repeat(55), ['G']),    'lowercase chars rejected');
  assert(!isValidStellarKey('G' + '1'.repeat(55), ['G']),    'digit 1 rejected (not in base32)');
  assert(!isValidStellarKey(null, ['G']),                     'null rejected');
});

// ── Static HTML audit ─────────────────────────────────────────────────────────

describe('multisig.html – inputs are labelled and linked to errors', () => {
  assert(html.includes('for="payment-id"'),      'payment-id label uses for=');
  assert(html.includes('for="merchant-address"'), 'merchant-address label uses for=');
  assert(html.includes('for="token-address"'),    'token-address label uses for=');
  assert(html.includes('for="amount"'),           'amount label uses for=');
  assert(html.includes('for="required-sigs"'),    'required-sigs label uses for=');
});

describe('multisig.html – inputs have aria-describedby linking to error divs', () => {
  assert(html.includes('aria-describedby="err-payment-id"'),  'payment-id aria-describedby');
  assert(html.includes('aria-describedby="err-merchant"'),    'merchant-address aria-describedby');
  assert(html.includes('aria-describedby="err-token"'),       'token-address aria-describedby');
  // amount has compound describedby: hint + error
  assert(html.includes('aria-describedby="amount-hint err-amount"'), 'amount aria-describedby (compound)');
  assert(html.includes('aria-describedby="threshold-msg"'),   'required-sigs aria-describedby');
});

describe('multisig.html – inputs have aria-invalid="false" by default', () => {
  assert(
    count(html, /aria-invalid="false"/g) >= 5,
    'At least 5 inputs have aria-invalid="false" as default'
  );
});

describe('multisig.html – inputs have aria-required="true"', () => {
  assert(
    count(html, /aria-required="true"/g) >= 4,
    'At least 4 required inputs have aria-required="true"'
  );
});

describe('multisig.html – error divs are empty by default (text set by JS)', () => {
  // Error divs should not have hardcoded text in the HTML source
  const errIds = ['err-payment-id', 'err-merchant', 'err-token', 'err-amount', 'err-signers'];
  errIds.forEach(id => {
    const match = html.match(new RegExp(`id="${id}"[^>]*>([^<]*)<`));
    if (match) {
      const content = match[1].trim();
      assert(content === '', `${id} has no hardcoded error text in HTML (got: "${content}")`);
    } else {
      assert(false, `${id} div not found`);
    }
  });
});

describe('multisig.html – error divs have role="alert" and aria-live', () => {
  // Each inline error div should have role="alert" or aria-live for live announcements
  assert(
    count(html, /role="alert"/g) >= 5,
    'At least 5 error divs have role="alert"'
  );
  assert(
    count(html, /aria-live="polite"/g) >= 4,
    'Error divs have aria-live="polite"'
  );
});

describe('multisig.html – setFieldError function is defined and used', () => {
  assert(html.includes('function setFieldError'), 'setFieldError function defined');
  assert(html.includes('setAttribute(\'aria-invalid\'') ||
         html.includes('setAttribute("aria-invalid"'), 'setFieldError sets aria-invalid');
  assert(html.includes('classList.add(\'error\')') ||
         html.includes('classList.add("error")'), 'setFieldError adds .error class');
});

describe('multisig.html – per-field blur validation is wired', () => {
  assert(html.includes("addEventListener('blur'") || html.includes('addEventListener("blur"'),
    'blur event listeners are attached for inline feedback');
  assert(
    html.includes('validatePaymentId(true)') &&
    html.includes('validateMerchant(true)')  &&
    html.includes('validateToken(true)')     &&
    html.includes('validateAmount(true)'),
    'All required fields have blur-time validators'
  );
});

describe('multisig.html – validateForm focuses first invalid field', () => {
  assert(
    html.includes('firstInvalid.focus()') || html.includes('[aria-invalid="true"]'),
    'validateForm moves focus to first invalid field on error'
  );
});

describe('multisig.html – signer inputs have aria-label and aria-invalid', () => {
  assert(
    html.includes('aria-label="Signer address 1"') ||
    html.includes('aria-label=`Signer address'),
    'Signer inputs have numbered aria-label'
  );
  assert(html.includes('refreshSignerLabels'), 'refreshSignerLabels called to keep labels accurate');
});

describe('styles.css – validation CSS uses aria-invalid hook', () => {
  const css = readFile('styles.css');
  assert(css.includes('[aria-invalid="true"]'),  'Error border driven by aria-invalid="true"');
  assert(css.includes('[aria-invalid="false"]'), 'Valid border driven by aria-invalid="false"');
  assert(css.includes('.err-msg.visible::before'), 'Error icon prefix added via ::before');
});

// ── Summary ───────────────────────────────────────────────────────────────────

console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
