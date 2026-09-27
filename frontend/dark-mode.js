/**
 * dark-mode.js
 *
 * Manual dark / light mode toggle for LumenFlow frontend pages.
 *
 * Usage:
 *   import { initDarkMode } from './dark-mode.js';
 *   initDarkMode();
 *
 * Behaviour:
 *  - Reads localStorage key 'lf-theme' on load ('dark' | 'light' | unset).
 *  - When unset, follows the OS/browser @media (prefers-color-scheme) preference.
 *  - Sets data-theme="dark" or data-theme="light" on <html> to override CSS vars.
 *  - Injects a fixed toggle button (bottom-right) with aria-label that updates.
 *  - Persists the user choice to localStorage on every toggle.
 *  - Emits a CustomEvent 'lf:themechange' on window with detail { theme: 'dark'|'light' }.
 */

const STORAGE_KEY = 'lf-theme';

function getSystemTheme() {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function getStoredTheme() {
  try { return localStorage.getItem(STORAGE_KEY); } catch { return null; }
}

function saveTheme(theme) {
  try { localStorage.setItem(STORAGE_KEY, theme); } catch { /* ignore */ }
}

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);

  // Update toggle button if already rendered
  const btn = document.getElementById('lf-dark-toggle');
  if (btn) {
    btn.textContent    = theme === 'dark' ? '☀️' : '🌙';
    btn.setAttribute('aria-label', theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode');
    btn.setAttribute('aria-pressed', String(theme === 'dark'));
  }

  window.dispatchEvent(new CustomEvent('lf:themechange', { detail: { theme } }));
}

/**
 * Initialises dark mode.  Call once per page after DOMContentLoaded.
 */
export function initDarkMode() {
  // Determine initial theme
  const stored = getStoredTheme();
  const initial = stored || getSystemTheme();
  applyTheme(initial);

  // Create toggle button
  const btn = document.createElement('button');
  btn.id             = 'lf-dark-toggle';
  btn.type           = 'button';
  btn.textContent    = initial === 'dark' ? '☀️' : '🌙';
  btn.setAttribute('aria-label',   initial === 'dark' ? 'Switch to light mode' : 'Switch to dark mode');
  btn.setAttribute('aria-pressed', String(initial === 'dark'));
  btn.setAttribute('title',        'Toggle dark / light mode');

  btn.addEventListener('click', () => {
    const current = document.documentElement.getAttribute('data-theme') || getSystemTheme();
    const next    = current === 'dark' ? 'light' : 'dark';
    saveTheme(next);
    applyTheme(next);
  });

  // Append after DOM is ready
  if (document.body) {
    document.body.appendChild(btn);
  } else {
    document.addEventListener('DOMContentLoaded', () => document.body.appendChild(btn));
  }

  // React to OS preference changes (only when no stored preference)
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
    if (getStoredTheme()) return; // user has an explicit choice — don't override
    applyTheme(e.matches ? 'dark' : 'light');
  });
}
