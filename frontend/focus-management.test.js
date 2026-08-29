/**
 * Unit tests for the LumenFlow Focus Management utilities (issue #790).
 *
 * Tests the Node.js-compatible parts of focus-management.js:
 *   - FocusTrap keyboard handling logic
 *   - ToastManager API (DOM-side, via jsdom-lite simulation)
 *   - getFocusable helper (simulated)
 *   - moveFocusTo / restoreFocus helpers
 *
 * Run with Node.js:
 *   node frontend/focus-management.test.js
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

// ── Minimal DOM stub for Node.js ──────────────────────────────────────────────

/**
 * Very small DOM simulation to test focus-trap and toast logic without a browser.
 */
function makeFakeElement(tagName, attrs) {
  const el = {
    tagName:    (tagName || 'div').toUpperCase(),
    _attrs:     Object.assign({}, attrs || {}),
    _children:  [],
    _listeners: {},
    _focused:   false,
    style:      {},
    className:  '',
    textContent: '',
    innerHTML:  '',

    getAttribute:    function (k)    { return this._attrs[k] !== undefined ? this._attrs[k] : null; },
    setAttribute:    function (k, v) { this._attrs[k] = String(v); },
    hasAttribute:    function (k)    { return k in this._attrs; },
    removeAttribute: function (k)    { delete this._attrs[k]; },
    classList: {
      _set: new Set(),
      add:    function (c)    { this._set.add(c); },
      remove: function (c)    { this._set.delete(c); },
      contains: function (c)  { return this._set.has(c); },
    },
    querySelectorAll: function () { return []; },
    querySelector:    function () { return null; },
    contains:         function (child) { return this._children.includes(child); },
    appendChild:      function (child) { this._children.push(child); return child; },
    removeChild:      function (child) {
      const i = this._children.indexOf(child);
      if (i !== -1) this._children.splice(i, 1);
    },
    addEventListener:    function (ev, fn) {
      (this._listeners[ev] = this._listeners[ev] || []).push(fn);
    },
    removeEventListener: function (ev, fn) {
      if (!this._listeners[ev]) return;
      const i = this._listeners[ev].indexOf(fn);
      if (i !== -1) this._listeners[ev].splice(i, 1);
    },
    focus: function () { this._focused = true; },
    closest: function () { return null; },
    parentNode: null,
  };
  return el;
}

// Fake document for the Node.js environment
const fakeDoc = {
  _activeElement: null,
  _listeners: {},
  get activeElement() { return this._activeElement; },
  createElement:    function (tag) { return makeFakeElement(tag); },
  getElementById:   function ()    { return null; },
  querySelector:    function ()    { return null; },
  querySelectorAll: function ()    { return []; },
  head:             makeFakeElement('head'),
  body:             makeFakeElement('body'),
  addEventListener:    function (ev, fn, capture) {
    const key = ev + (capture ? '__capture' : '');
    (this._listeners[key] = this._listeners[key] || []).push(fn);
  },
  removeEventListener: function (ev, fn, capture) {
    const key = ev + (capture ? '__capture' : '');
    if (!this._listeners[key]) return;
    const i = this._listeners[key].indexOf(fn);
    if (i !== -1) this._listeners[key].splice(i, 1);
  },
  // Simulate a keydown event
  _dispatchKeydown: function (keyProps) {
    const listeners = this._listeners['keydown__capture'] || [];
    const event = Object.assign({ preventDefault: function () { this._prevented = true; }, _prevented: false }, keyProps);
    listeners.forEach(fn => fn(event));
    return event;
  },
};

// Patch globals before loading the module
globalThis.document = fakeDoc;
globalThis.window   = globalThis.window || {};
globalThis.requestAnimationFrame = function (fn) { fn(); };

const LumenFocus = require('./focus-management.js');

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('Module exports', () => {
  assert(typeof LumenFocus              === 'object',   'module exports an object');
  assert(typeof LumenFocus.getFocusable === 'function', 'exports getFocusable');
  assert(typeof LumenFocus.moveFocusTo  === 'function', 'exports moveFocusTo');
  assert(typeof LumenFocus.restoreFocus === 'function', 'exports restoreFocus');
  assert(typeof LumenFocus.createFocusTrap === 'function', 'exports createFocusTrap');
  assert(typeof LumenFocus.toast           === 'object',   'exports toast manager');
  assert(typeof LumenFocus.toast.show      === 'function', 'toast.show is a function');
  assert(typeof LumenFocus.toast.dismiss   === 'function', 'toast.dismiss is a function');
  assert(typeof LumenFocus.toast.dismissAll === 'function', 'toast.dismissAll is a function');
});

describe('createFocusTrap – initial state', () => {
  const container = makeFakeElement('div');
  const trap = LumenFocus.createFocusTrap(container);

  assert(typeof trap.activate   === 'function', 'trap.activate is a function');
  assert(typeof trap.deactivate === 'function', 'trap.deactivate is a function');
  assert(typeof trap.isActive   === 'function', 'trap.isActive is a function');
  assertEqual(trap.isActive(), false, 'trap is not active before activate()');
});

describe('createFocusTrap – activate and deactivate', () => {
  const container = makeFakeElement('div');
  const trap = LumenFocus.createFocusTrap(container);

  fakeDoc._activeElement = makeFakeElement('button');

  trap.activate();
  assertEqual(trap.isActive(), true, 'trap.isActive() returns true after activate');

  trap.deactivate();
  assertEqual(trap.isActive(), false, 'trap.isActive() returns false after deactivate');
});

describe('createFocusTrap – deactivate restores focus', () => {
  const trigger = makeFakeElement('button');
  fakeDoc._activeElement = trigger;

  const container = makeFakeElement('div');
  const trap = LumenFocus.createFocusTrap(container);

  trap.activate();
  fakeDoc._activeElement = makeFakeElement('input'); // focus moved inside trap
  trap.deactivate();

  assert(trigger._focused, 'focus restored to trigger after deactivate()');
});

describe('createFocusTrap – Escape calls onEscape callback', () => {
  const container = makeFakeElement('div');
  let escapeCalled = false;

  const trap = LumenFocus.createFocusTrap(container, {
    onEscape: function () { escapeCalled = true; }
  });

  trap.activate();
  fakeDoc._dispatchKeydown({ key: 'Escape' });
  assert(escapeCalled, 'onEscape callback called when Escape pressed');
  trap.deactivate(true);
});

describe('createFocusTrap – Tab wraps to last when no focusable children', () => {
  const container = makeFakeElement('div');
  // container has no focusable children → Tab should be preventDefault'd
  const trap = LumenFocus.createFocusTrap(container);
  trap.activate();

  const evt = fakeDoc._dispatchKeydown({ key: 'Tab', shiftKey: false });
  assert(evt._prevented, 'Tab preventDefault when no focusable elements');
  trap.deactivate(true);
});

describe('createFocusTrap – double activate is idempotent', () => {
  const container = makeFakeElement('div');
  const trap = LumenFocus.createFocusTrap(container);

  trap.activate();
  trap.activate(); // second call should be no-op
  assertEqual(trap.isActive(), true, 'still active after double activate');

  // Only one keydown listener should be registered
  const listenerCount = (fakeDoc._listeners['keydown__capture'] || []).length;
  assert(listenerCount <= 1, 'only one keydown listener after double activate');

  trap.deactivate(true);
});

describe('restoreFocus', () => {
  const el = makeFakeElement('button');
  LumenFocus.restoreFocus(el);
  assert(el._focused, 'restoreFocus calls focus() on the element');

  // Calling with null should not throw
  let threw = false;
  try { LumenFocus.restoreFocus(null); } catch (e) { threw = true; }
  assert(!threw, 'restoreFocus(null) does not throw');
});

describe('moveFocusTo – falls back to container', () => {
  const container = makeFakeElement('div');
  // querySelectorAll returns empty → falls back to container
  LumenFocus.moveFocusTo(container);
  assert(container._focused, 'container focused when no focusable children');
  assertEqual(container.getAttribute('tabindex'), '-1', 'tabindex="-1" set on container');
});

describe('toast API surface', () => {
  // toast.show in JSDOM-free environment should not throw
  let threw = false;
  try {
    LumenFocus.toast.show('Hello', 'success', 0);
    LumenFocus.toast.dismissAll();
  } catch (e) { threw = true; }
  assert(!threw, 'toast.show / dismissAll do not throw in headless environment');
});

// ── Static file audit ─────────────────────────────────────────────────────────

const fs = require('fs');
const path = require('path');

function readFile(name) {
  return fs.readFileSync(path.join(__dirname, name), 'utf8');
}

describe('Static audit – focus-management.js is loaded in HTML pages', () => {
  const pages = ['multisig.html', 'receipt.html', 'payment-history-paginated.html', 'history.html'];
  pages.forEach(page => {
    const html = readFile(page);
    assert(
      html.includes('focus-management.js'),
      page + ' loads focus-management.js'
    );
  });
});

describe('Static audit – panel transitions move focus', () => {
  const multisig = readFile('multisig.html');
  assert(
    multisig.includes('heading.focus()') || multisig.includes('moveFocusTo'),
    'multisig.html moves focus when transitioning to progress panel'
  );
  assert(
    multisig.includes('requestAnimationFrame'),
    'multisig.html defers focus to next frame to ensure panel is visible'
  );
});

describe('Static audit – receipt.html moves focus after async load', () => {
  const receipt = readFile('receipt.html');
  assert(receipt.includes('heading.focus()'), 'receipt.html moves focus after async load');
});

describe('Static audit – paginated history announces page change', () => {
  const html = readFile('payment-history-paginated.html');
  assert(html.includes('aria-live="polite"'), 'page-meta has aria-live="polite"');
  assert(
    html.includes('firstCell.focus()') || html.includes('moveFocusTo'),
    'loadPage moves focus after pagination navigation'
  );
});

// ── Summary ───────────────────────────────────────────────────────────────────

console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
