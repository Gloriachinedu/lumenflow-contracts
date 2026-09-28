/**
 * Unit tests for focus-visible-polyfill.js (issue #1016)
 *
 * Tests polyfill behavior in a Node.js environment using a minimal DOM stub.
 * Covers:
 *   - .focus-visible added on keyboard focus
 *   - .focus-visible NOT added on pointer (mouse/touch) focus
 *   - .focus-visible always added for text inputs regardless of pointer use
 *   - .focus-visible removed on blur
 *   - window.LumenFocusVisiblePolyfill.active is set to true
 *   - hasFocusVisible() utility works correctly
 *
 * Run:
 *   node frontend/focus-visible-polyfill.test.js
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

function describe(title, fn) {
  console.log('\n' + title);
  fn();
}

// ── Minimal DOM stub ──────────────────────────────────────────────────────────

function makeElement(tagName, attrs) {
  const classList = new Set();
  const el = {
    tagName: (tagName || 'div').toUpperCase(),
    _attrs: Object.assign({}, attrs || {}),
    _listeners: {},
    _children: [],
    style: {},
    id: (attrs && attrs.id) || '',
    isContentEditable: false,
    get type() { return this._attrs['type'] || ''; },
    classList: {
      add(c)        { classList.add(c); },
      remove(c)     { classList.delete(c); },
      contains(c)   { return classList.has(c); },
    },
    getAttribute(k)    { return this._attrs[k] !== undefined ? this._attrs[k] : null; },
    setAttribute(k, v) { this._attrs[k] = String(v); },
    hasAttribute(k)    { return k in this._attrs; },
    removeAttribute(k) { delete this._attrs[k]; },
    querySelectorAll() { return []; },
    querySelector()    { return null; },
    contains(c)        { return this._children.includes(c); },
    appendChild(c)     { this._children.push(c); return c; },
    insertBefore(n, r) { this._children.unshift(n); return n; },
    addEventListener(ev, fn) {
      (this._listeners[ev] = this._listeners[ev] || []).push(fn);
    },
    removeEventListener(ev, fn) {
      if (!this._listeners[ev]) return;
      const i = this._listeners[ev].indexOf(fn);
      if (i !== -1) this._listeners[ev].splice(i, 1);
    },
    focus() { this._focused = true; },
    closest() { return null; },
    parentNode: null,
  };
  return el;
}

// Document listeners (capture phase)
const captureListeners = {};
const fakeHead = makeElement('head');
fakeHead.querySelector = () => null; // no existing style/link

const fakeDoc = {
  _activeElement: null,
  _listeners: captureListeners,
  createElement(tag) {
    const el = makeElement(tag);
    if (tag === 'style') { el.textContent = ''; }
    return el;
  },
  getElementById()   { return null; },
  querySelector()    { return null; },
  querySelectorAll() { return []; },
  head: fakeHead,
  body: makeElement('body'),
  addEventListener(ev, fn, capture) {
    const key = ev + (capture ? '__cap' : '');
    (captureListeners[key] = captureListeners[key] || []).push(fn);
  },
  removeEventListener(ev, fn, capture) {
    const key = ev + (capture ? '__cap' : '');
    if (!captureListeners[key]) return;
    const i = captureListeners[key].indexOf(fn);
    if (i !== -1) captureListeners[key].splice(i, 1);
  },
};

// Override :focus-visible detection to return false (simulating Safari < 15.4)
fakeDoc.querySelector = (sel) => {
  if (sel === ':focus-visible') throw new Error('unsupported');
  return null;
};

// Patch globals
globalThis.document = fakeDoc;
globalThis.window   = globalThis.window || {};

// Load polyfill
require('./focus-visible-polyfill.js');

// ── Helpers to fire events ────────────────────────────────────────────────────

function fire(eventName, target, extra) {
  const listeners = captureListeners[eventName + '__cap'] || [];
  const event = Object.assign({ target, preventDefault() {} }, extra || {});
  listeners.forEach(fn => fn(event));
}

function keydown(key) {
  fire('keydown', null, { key });
}

function pointerdown() {
  fire('pointerdown', null, {});
}

function focus(el) {
  fire('focus', el, {});
}

function blur(el) {
  fire('blur', el, {});
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('Polyfill public API', () => {
  assert(
    globalThis.window.LumenFocusVisiblePolyfill !== undefined,
    'window.LumenFocusVisiblePolyfill is set'
  );
  assert(
    globalThis.window.LumenFocusVisiblePolyfill.active === true,
    'LumenFocusVisiblePolyfill.active is true'
  );
  assert(
    typeof globalThis.window.LumenFocusVisiblePolyfill.hasFocusVisible === 'function',
    'hasFocusVisible is a function'
  );
});

describe('CSS injection', () => {
  const injected = fakeHead._children.some(c => c.id === 'lf-focus-visible-polyfill');
  assert(injected, '<style id="lf-focus-visible-polyfill"> was injected into <head>');
});

describe('Keyboard focus adds .focus-visible', () => {
  const button = makeElement('button');
  keydown('Tab');
  focus(button);
  assert(button.classList.contains('focus-visible'), '.focus-visible added after Tab + focus');
});

describe('Pointer focus does NOT add .focus-visible', () => {
  const button = makeElement('button');
  pointerdown();
  focus(button);
  assert(!button.classList.contains('focus-visible'), '.focus-visible NOT added after pointerdown + focus');
});

describe('Blur removes .focus-visible', () => {
  const button = makeElement('button');
  keydown('Tab');
  focus(button);
  assert(button.classList.contains('focus-visible'), '.focus-visible added before blur');
  blur(button);
  assert(!button.classList.contains('focus-visible'), '.focus-visible removed after blur');
});

describe('Text input always gets .focus-visible regardless of pointer', () => {
  const input = makeElement('input', { type: 'text' });
  input.tagName = 'INPUT';
  pointerdown();
  focus(input);
  assert(input.classList.contains('focus-visible'), '.focus-visible added to text input after pointerdown');
});

describe('Checkbox does NOT get .focus-visible after pointer', () => {
  const checkbox = makeElement('input', { type: 'checkbox' });
  checkbox.tagName = 'INPUT';
  pointerdown();
  focus(checkbox);
  assert(!checkbox.classList.contains('focus-visible'), '.focus-visible NOT added to checkbox after pointerdown');
});

describe('hasFocusVisible utility', () => {
  const polyfill = globalThis.window.LumenFocusVisiblePolyfill;
  const el = makeElement('button');
  assert(!polyfill.hasFocusVisible(el),     'hasFocusVisible returns false before focus-visible');
  el.classList.add('focus-visible');
  assert(polyfill.hasFocusVisible(el),      'hasFocusVisible returns true when .focus-visible present');
  assert(!polyfill.hasFocusVisible(null),   'hasFocusVisible(null) returns false without throw');
  assert(!polyfill.hasFocusVisible({}),     'hasFocusVisible({}) returns false without throw');
});

describe('Multiple sequential focuses work correctly', () => {
  const a = makeElement('a');
  const b = makeElement('button');

  keydown('Tab');
  focus(a);
  assert(a.classList.contains('focus-visible'), 'first element gets .focus-visible');

  blur(a);
  assert(!a.classList.contains('focus-visible'), 'first element loses .focus-visible on blur');

  focus(b);
  assert(b.classList.contains('focus-visible'), 'second element gets .focus-visible (keyboard state persists)');
  blur(b);
});

// ── Summary ───────────────────────────────────────────────────────────────────

console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
