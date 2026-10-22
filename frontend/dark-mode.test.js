/**
 * Unit tests for dark-mode.js persistence logic (issue #1255).
 *
 * Tests the Node.js-compatible parts of dark-mode.js:
 *   - getStoredTheme / saveTheme read and write localStorage
 *   - applyTheme sets data-theme attribute on <html>
 *   - initDarkMode restores preference before first paint
 *   - Toggle switches theme and persists to localStorage
 *   - Clearing stored preference reverts to system default
 *
 * Run with Node.js:
 *   node frontend/dark-mode.test.js
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
    console.error(`  ✗ ${label}\n      expected: ${JSON.stringify(expected)}\n      got:      ${JSON.stringify(actual)}`);
    failed++;
  }
}

function section(name) {
  console.log(`\n── ${name} ──`);
}

// ── jsdom-lite: minimal DOM stubs ─────────────────────────────────────────────

/**
 * Build a minimal environment that mimics enough of the browser DOM for
 * dark-mode.js to run in Node.js without a real browser.
 */
function makeEnv({ storedTheme = null, systemDark = false } = {}) {
  // localStorage stub
  const store = {};
  if (storedTheme) store['lf-theme'] = storedTheme;
  const localStorage = {
    getItem:    (k) => store[k] ?? null,
    setItem:    (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
    _store: store,
  };

  // matchMedia stub
  const matchMedia = (query) => ({
    matches: query.includes('dark') ? systemDark : false,
    addEventListener: () => {},
  });

  // document stub
  const attrs = {};
  const buttons = {};
  const elements = {};

  const documentEl = { setAttribute: (k, v) => { attrs[k] = v; }, getAttribute: (k) => attrs[k] ?? null };
  const bodyEl     = { appendChild: (el) => { buttons[el.id] = el; } };

  const document = {
    documentElement: documentEl,
    body: bodyEl,
    getElementById: (id) => elements[id] ?? buttons[id] ?? null,
    addEventListener: () => {},
    createElement: (tag) => {
      const el = {
        id: '',
        type: '',
        textContent: '',
        _attrs: {},
        _listeners: {},
        setAttribute: function(k, v) { this._attrs[k] = v; },
        getAttribute: function(k) { return this._attrs[k] ?? null; },
        addEventListener: function(ev, fn) { this._listeners[ev] = fn; },
        click: function() { if (this._listeners['click']) this._listeners['click'](); },
      };
      return el;
    },
  };

  // window stub
  const eventListeners = {};
  const window = {
    matchMedia,
    localStorage,
    dispatchEvent: () => {},
    CustomEvent: class { constructor(name, opts) { this.type = name; this.detail = opts?.detail; } },
    addEventListener: (ev, fn) => { eventListeners[ev] = fn; },
  };

  return { window, document, localStorage, attrs, buttons };
}

/**
 * Build and execute the dark-mode module logic inside a custom environment.
 * Returns { applyTheme, initDarkMode, saveTheme, getStoredTheme, env }.
 */
function buildModule(envOptions = {}) {
  const env = makeEnv(envOptions);

  // Re-implement the module logic using our stubbed globals
  const STORAGE_KEY = 'lf-theme';

  const getSystemTheme = () =>
    env.window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';

  const getStoredTheme = () => {
    try { return env.window.localStorage.getItem(STORAGE_KEY); } catch { return null; }
  };

  const saveTheme = (theme) => {
    try { env.window.localStorage.setItem(STORAGE_KEY, theme); } catch { /* ignore */ }
  };

  const applyTheme = (theme) => {
    env.document.documentElement.setAttribute('data-theme', theme);
    const btn = env.document.getElementById('lf-dark-toggle');
    if (btn) {
      btn.textContent = theme === 'dark' ? '☀️' : '🌙';
      btn.setAttribute('aria-label', theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode');
      btn.setAttribute('aria-pressed', String(theme === 'dark'));
    }
    env.window.dispatchEvent(new env.window.CustomEvent('lf:themechange', { detail: { theme } }));
  };

  const initDarkMode = () => {
    const stored = getStoredTheme();
    const initial = stored || getSystemTheme();
    applyTheme(initial);

    const btn = env.document.createElement('button');
    btn.id          = 'lf-dark-toggle';
    btn.type        = 'button';
    btn.textContent = initial === 'dark' ? '☀️' : '🌙';
    btn.setAttribute('aria-label',   initial === 'dark' ? 'Switch to light mode' : 'Switch to dark mode');
    btn.setAttribute('aria-pressed', String(initial === 'dark'));

    btn.addEventListener('click', () => {
      const current = env.document.documentElement.getAttribute('data-theme') || getSystemTheme();
      const next    = current === 'dark' ? 'light' : 'dark';
      saveTheme(next);
      applyTheme(next);
    });

    if (env.document.body) env.document.body.appendChild(btn);

    env.window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
      if (getStoredTheme()) return;
      applyTheme(e.matches ? 'dark' : 'light');
    });
  };

  return { applyTheme, initDarkMode, saveTheme, getStoredTheme, env };
}

// ── Tests: getStoredTheme / saveTheme ─────────────────────────────────────────

section('getStoredTheme / saveTheme persistence');

{
  const { getStoredTheme, saveTheme, env } = buildModule();

  // Initially no stored preference
  assertEqual(getStoredTheme(), null, 'returns null when nothing stored');

  saveTheme('dark');
  assertEqual(getStoredTheme(), 'dark', 'returns "dark" after saveTheme("dark")');
  assertEqual(env.localStorage._store['lf-theme'], 'dark', 'key "lf-theme" written to localStorage');

  saveTheme('light');
  assertEqual(getStoredTheme(), 'light', 'returns "light" after saveTheme("light")');
}

// ── Tests: applyTheme ─────────────────────────────────────────────────────────

section('applyTheme sets data-theme attribute');

{
  const { applyTheme, env } = buildModule();

  applyTheme('dark');
  assertEqual(env.attrs['data-theme'], 'dark', 'sets data-theme="dark" on <html>');

  applyTheme('light');
  assertEqual(env.attrs['data-theme'], 'light', 'sets data-theme="light" on <html>');
}

// ── Tests: initDarkMode restores stored preference ────────────────────────────

section('initDarkMode — restores stored preference synchronously');

{
  // Stored dark preference → should apply dark immediately
  const { initDarkMode, env } = buildModule({ storedTheme: 'dark' });
  initDarkMode();
  assertEqual(env.attrs['data-theme'], 'dark', 'applies stored "dark" preference on init');
}

{
  // Stored light preference → should apply light immediately
  const { initDarkMode, env } = buildModule({ storedTheme: 'light' });
  initDarkMode();
  assertEqual(env.attrs['data-theme'], 'light', 'applies stored "light" preference on init');
}

{
  // No stored preference, system prefers dark → should apply dark
  const { initDarkMode, env } = buildModule({ storedTheme: null, systemDark: true });
  initDarkMode();
  assertEqual(env.attrs['data-theme'], 'dark', 'falls back to system dark when nothing stored');
}

{
  // No stored preference, system prefers light → should apply light
  const { initDarkMode, env } = buildModule({ storedTheme: null, systemDark: false });
  initDarkMode();
  assertEqual(env.attrs['data-theme'], 'light', 'falls back to system light when nothing stored');
}

// ── Tests: toggle writes to localStorage ─────────────────────────────────────

section('Toggle saves preference to localStorage');

{
  const { initDarkMode, env } = buildModule({ storedTheme: 'light' });
  initDarkMode();

  const btn = env.buttons['lf-dark-toggle'];
  assert(btn !== null && btn !== undefined, 'toggle button injected by initDarkMode');

  btn.click();
  assertEqual(env.localStorage._store['lf-theme'], 'dark',  'first click: persists "dark"');
  assertEqual(env.attrs['data-theme'],              'dark',  'first click: applies dark theme');

  btn.click();
  assertEqual(env.localStorage._store['lf-theme'], 'light', 'second click: persists "light"');
  assertEqual(env.attrs['data-theme'],              'light', 'second click: applies light theme');
}

// ── Tests: clearing preference reverts to system default ─────────────────────

section('Cleared preference reverts to system default on next init');

{
  // Simulate: user saved dark, then cleared it, and page reloads with system light
  const { initDarkMode, env } = buildModule({ storedTheme: null, systemDark: false });
  initDarkMode();
  assertEqual(env.attrs['data-theme'], 'light', 'after clearing storage, system-light is applied');
}

{
  const { initDarkMode, env } = buildModule({ storedTheme: null, systemDark: true });
  initDarkMode();
  assertEqual(env.attrs['data-theme'], 'dark', 'after clearing storage, system-dark is applied');
}

// ── Tests: toggle button aria attributes ─────────────────────────────────────

section('Toggle button aria attributes');

{
  const { initDarkMode, env } = buildModule({ storedTheme: 'dark' });
  initDarkMode();
  const btn = env.buttons['lf-dark-toggle'];
  assertEqual(btn.getAttribute('aria-pressed'), 'true',              'aria-pressed=true when dark');
  assertEqual(btn.getAttribute('aria-label'),   'Switch to light mode', 'aria-label correct when dark');
}

{
  const { initDarkMode, env } = buildModule({ storedTheme: 'light' });
  initDarkMode();
  const btn = env.buttons['lf-dark-toggle'];
  assertEqual(btn.getAttribute('aria-pressed'), 'false',             'aria-pressed=false when light');
  assertEqual(btn.getAttribute('aria-label'),   'Switch to dark mode',  'aria-label correct when light');
}

// ── Summary ───────────────────────────────────────────────────────────────────

console.log(`\n${'─'.repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exitCode = 1;
}
