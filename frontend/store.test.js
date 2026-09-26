/**
 * Unit tests for the shared LumenFlow application store (issue #784).
 *
 * Run with Node.js (no test framework required):
 *   node frontend/store.test.js
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

// ── Load module ───────────────────────────────────────────────────────────────

// Provide a minimal globalThis.window so the store UMD initialises correctly.
globalThis.window = globalThis.window || {};

const store = require('./store.js');

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('Initial state', () => {
  const s = store.get();
  assert(s !== null && typeof s === 'object', 'get() returns an object');
  assert(typeof s.filters === 'object',        'state has filters');
  assert(typeof s.config  === 'object',        'state has config');
  assert(s.multisig === null,                  'multisig is null by default');
  assert(s.receipt  === null,                  'receipt is null by default');
  assert(s.ui.loading === false,               'loading is false by default');
  assert(s.ui.toast   === null,                'toast is null by default');
});

describe('Filters – setFilters and getActiveFilters', () => {
  store.reset();

  store.setFilters({ status: 'Completed', amount_min: '100' });
  const active = store.getActiveFilters();

  assertEqual(store.get().filters.status,     'Completed', 'status set correctly');
  assertEqual(store.get().filters.amount_min, '100',       'amount_min set correctly');
  assertEqual(active.length, 2, 'two active filters');
  assert(active.some(f => f.key === 'status' && f.value === 'Completed'),     'status in active filters');
  assert(active.some(f => f.key === 'amount_min' && f.value === '100'), 'amount_min in active filters');
});

describe('Filters – removeFilter', () => {
  store.reset();
  store.setFilters({ status: 'Completed', token: 'USDC' });

  store.removeFilter('status');
  assertEqual(store.get().filters.status, 'Any', 'status reset to default after remove');
  assertEqual(store.get().filters.token,  'USDC', 'other filters unaffected');
});

describe('Filters – resetFilters', () => {
  store.reset();
  store.setFilters({ status: 'Completed', token: 'USDC', amount_min: '50' });

  store.resetFilters();
  assertEqual(store.getActiveFilters().length, 0, 'no active filters after reset');
  assertEqual(store.get().filters.status, 'Any',  'status is Any after reset');
});

describe('Subscribe and unsubscribe', () => {
  store.reset();

  let callCount = 0;
  let lastChanged = [];

  const unsub = store.subscribe((state, changed) => {
    callCount++;
    lastChanged = changed;
  });

  store.setFilters({ status: 'FullyRefunded' });
  assertEqual(callCount, 1, 'listener called once on change');
  assert(lastChanged.includes('filters'), 'changed includes filters');

  unsub();
  store.setFilters({ status: 'Completed' });
  assertEqual(callCount, 1, 'listener not called after unsubscribe');
});

describe('Toast helpers', () => {
  store.reset();

  store.showToast('Hello', 'success', 0 /* no auto-dismiss */);
  assert(store.get().ui.toast !== null,                        'toast is set');
  assertEqual(store.get().ui.toast.message, 'Hello',           'toast message');
  assertEqual(store.get().ui.toast.type,    'success',         'toast type');

  store.dismissToast();
  assert(store.get().ui.toast === null, 'toast dismissed');
});

describe('Loading and error helpers', () => {
  store.reset();

  store.setLoading(true);
  assert(store.get().ui.loading === true, 'loading set to true');

  store.setLoading(false);
  assert(store.get().ui.loading === false, 'loading set to false');

  store.setError('Something went wrong');
  assertEqual(store.get().ui.error, 'Something went wrong', 'error message set');

  store.setError(null);
  assert(store.get().ui.error === null, 'error cleared');
});

describe('Arbitrary state via set()', () => {
  store.reset();

  const ms = { paymentId: 'MS_001', signers: ['GA...', 'GB...'], required: 2, signatures: new Set() };
  store.set({ multisig: ms });
  assertEqual(store.get().multisig.paymentId, 'MS_001', 'multisig state stored');
  assertEqual(store.get().multisig.required,  2,        'required threshold stored');
});

describe('get() returns a shallow clone (mutation guard)', () => {
  store.reset();
  store.setFilters({ status: 'Completed' });

  const snap = store.get();
  snap.filters.status = 'MUTATED';

  assertEqual(store.get().filters.status, 'Completed', 'internal state not mutated via get() clone');
});

describe('Edge case – set() with no changes does not notify', () => {
  store.reset();
  store.setFilters({ status: 'Any' }); // same as default

  let callCount = 0;
  const unsub = store.subscribe(() => callCount++);

  // Setting the same value should not trigger notification
  store.set({ multisig: store.get().multisig }); // identical reference → no change
  assertEqual(callCount, 0, 'no notification when value unchanged');

  unsub();
});

// ── Summary ───────────────────────────────────────────────────────────────────

console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
