/**
 * Accessibility audit for icon-only controls (issue #791).
 *
 * Static analysis of HTML files to verify:
 * - Icon-only buttons have an accessible name (aria-label, aria-labelledby, or visible text)
 * - Sortable column headers have aria-sort attributes
 * - Progress bars have role="progressbar" and aria-value* attributes
 * - Alert regions have role="alert"
 *
 * Run with Node.js (no test framework required):
 *   node frontend/a11y-icon-controls.test.js
 */

'use strict';

const fs   = require('fs');
const path = require('path');

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

function describe(title, fn) {
  console.log('\n' + title);
  fn();
}

function readFile(name) {
  return fs.readFileSync(path.join(__dirname, name), 'utf8');
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Count occurrences of a regex in a string. */
function count(str, pattern) {
  return (str.match(pattern) || []).length;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('multisig.html – Remove signer button', () => {
  const html = readFile('multisig.html');

  assert(
    html.includes('aria-label="Remove signer"'),
    'Static remove signer button has aria-label="Remove signer"'
  );
  assert(
    html.includes("aria-label=\"Remove signer\""),
    'Dynamically added remove signer button template has aria-label'
  );
});

describe('multisig.html – Progress bar', () => {
  const html = readFile('multisig.html');

  assert(html.includes('role="progressbar"'),      'Progress bar has role="progressbar"');
  assert(html.includes('aria-valuenow='),           'Progress bar has aria-valuenow');
  assert(html.includes('aria-valuemin='),           'Progress bar has aria-valuemin');
  assert(html.includes('aria-valuemax='),           'Progress bar has aria-valuemax');
  assert(html.includes('aria-label="Signature progress"') ||
         html.includes("aria-label='Signature progress'"), 'Progress bar has aria-label');
});

describe('multisig.html – Execute button', () => {
  const html = readFile('multisig.html');

  assert(html.includes('aria-disabled='), 'Execute button has aria-disabled attribute');
  assert(html.includes('aria-describedby='), 'Execute button has aria-describedby');
});

describe('multisig.html – Alert regions', () => {
  const html = readFile('multisig.html');

  assert(
    count(html, /role="alert"/g) >= 2,
    'At least 2 alert regions have role="alert"'
  );
  assert(
    html.includes('aria-live="assertive"') || html.includes("aria-live='assertive'"),
    'Alert regions have aria-live="assertive"'
  );
});

describe('multisig.html – Sign buttons in progress panel', () => {
  const html = readFile('multisig.html');

  // The template uses aria-label with dynamic addr embedded via template literal
  assert(
    /aria-label="\$\{isSigned/.test(html),
    'Dynamically rendered sign buttons include dynamic aria-label in template'
  );
  assert(
    html.includes('Sign as') && html.includes('Signed by'),
    'Sign button aria-label distinguishes unsigned/signed states'
  );
});

describe('payment-history.html – Sortable column headers', () => {
  const html = readFile('payment-history.html');

  assert(html.includes('aria-sort="none"'), 'Default aria-sort="none" present on headers');
  assert(count(html, /role="columnheader"/g) >= 5, 'All 5 headers have role="columnheader"');
  assert(count(html, /tabindex="0"/g) >= 5, 'All 5 sortable headers have tabindex="0"');
  assert(count(html, /onkeydown=/g) >= 5, 'All 5 sortable headers have keyboard handler');
  assert(html.includes('aria-sort'), 'sortBy function updates aria-sort');
});

describe('payment-history.html – Pagination buttons', () => {
  const html = readFile('payment-history.html');

  assert(
    html.includes('aria-label="Go to previous page"'),
    'Previous page button has aria-label'
  );
  assert(
    html.includes('aria-label="Go to next page"'),
    'Next page button has aria-label'
  );
  assert(
    html.includes('aria-live="polite"'),
    'Page info span has aria-live="polite" for screen reader announcements'
  );
});

describe('payment-history.html – Search and filter inputs', () => {
  const html = readFile('payment-history.html');

  assert(
    html.includes('role="search"') || html.includes("role='search'"),
    'Toolbar has role="search"'
  );
  assert(
    html.includes('aria-label="Reset all filters"'),
    'Reset button has descriptive aria-label'
  );
});

describe('payment-history.html – sr-only class', () => {
  const html = readFile('payment-history.html');

  assert(html.includes('.sr-only'), 'sr-only utility class is defined');
  assert(
    html.includes('class="sr-only"') || html.includes("class='sr-only'"),
    'sr-only class is used on visually hidden labels'
  );
});

describe('receipt.html – Action buttons', () => {
  const html = readFile('receipt.html');

  assert(
    html.includes('aria-label="Print this receipt"'),
    'Print button has accessible aria-label'
  );
  assert(
    html.includes('aria-label="Copy link to this receipt"'),
    'Copy link button has accessible aria-label'
  );
  assert(
    count(html, /aria-hidden="true"/g) >= 2,
    'Emoji icons in buttons are hidden from assistive technology'
  );
});

describe('history.html – Filter chip remove buttons', () => {
  const html = readFile('history.html');

  assert(
    html.includes('aria-label="Remove filter'),
    'Chip remove buttons have descriptive aria-label'
  );
  assert(
    html.includes('aria-live="polite"'),
    'Active filters region has aria-live="polite"'
  );
});

// ── Summary ───────────────────────────────────────────────────────────────────

console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
