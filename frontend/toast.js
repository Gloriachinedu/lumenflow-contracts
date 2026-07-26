/**
 * toast.js — LumenFlow shared toast notification system.
 *
 * Usage (ES module):
 *   import { showToast } from './toast.js';
 *   showToast('Payment confirmed!', 'success');
 *   showToast('Connection failed.', 'error');
 *   showToast('Please check your input.', 'info');
 *
 * Usage (non-module, after a <script type="module"> has loaded this file):
 *   window.showToast('Message', 'success');
 */

// ── Constants ──────────────────────────────────────────────────────────────────
const TOAST_DURATION_MS = 5000;
const CONTAINER_ID      = 'lf-toast-container';

// ── Styles injected once ───────────────────────────────────────────────────────
const TOAST_CSS = `
#lf-toast-container {
  position: fixed;
  top: 1.25rem;
  right: 1.25rem;
  z-index: 99999;
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
  max-width: min(360px, calc(100vw - 2rem));
  pointer-events: none;
}

.lf-toast {
  pointer-events: all;
  display: flex;
  align-items: flex-start;
  gap: 0.65rem;
  padding: 0.85rem 1rem;
  border-radius: 10px;
  box-shadow: 0 4px 18px rgba(0,0,0,0.14);
  font-family: system-ui, -apple-system, sans-serif;
  font-size: 0.875rem;
  font-weight: 500;
  line-height: 1.4;
  color: #fff;
  animation: lf-toast-in 0.25s ease forwards;
  min-width: 240px;
}

.lf-toast.lf-toast-exit {
  animation: lf-toast-out 0.3s ease forwards;
}

.lf-toast-success { background: #1a9e5c; }
.lf-toast-error   { background: #d9382a; }
.lf-toast-info    { background: #2563eb; }

.lf-toast-icon {
  flex-shrink: 0;
  font-style: normal;
  font-size: 1rem;
  line-height: 1.4;
}

.lf-toast-body { flex: 1; }

.lf-toast-close {
  flex-shrink: 0;
  background: transparent;
  border: none;
  color: rgba(255,255,255,0.8);
  cursor: pointer;
  font-size: 1.1rem;
  line-height: 1;
  padding: 0 0.2rem;
  align-self: flex-start;
  margin-top: -0.05rem;
  transition: color 0.1s;
}
.lf-toast-close:hover { color: #fff; }
.lf-toast-close:focus-visible {
  outline: 2px solid rgba(255,255,255,0.8);
  outline-offset: 2px;
  border-radius: 3px;
}

@keyframes lf-toast-in {
  from { opacity: 0; transform: translateX(110%); }
  to   { opacity: 1; transform: translateX(0);    }
}

@keyframes lf-toast-out {
  from { opacity: 1; transform: translateX(0);    max-height: 200px; margin-bottom: 0; }
  to   { opacity: 0; transform: translateX(110%); max-height: 0;     margin-bottom: -0.6rem; }
}
`;

// ── Internal helpers ───────────────────────────────────────────────────────────

function ensureContainer() {
  let container = document.getElementById(CONTAINER_ID);
  if (container) return container;

  // Inject styles once
  if (!document.getElementById('lf-toast-styles')) {
    const style = document.createElement('style');
    style.id = 'lf-toast-styles';
    style.textContent = TOAST_CSS;
    document.head.appendChild(style);
  }

  container = document.createElement('div');
  container.id = CONTAINER_ID;
  container.setAttribute('aria-label', 'Notifications');
  document.body.appendChild(container);
  return container;
}

function removeToast(toastEl) {
  toastEl.classList.add('lf-toast-exit');
  toastEl.addEventListener('animationend', () => {
    if (toastEl.parentNode) toastEl.parentNode.removeChild(toastEl);
  }, { once: true });
}

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Shows a toast notification that slides in from the top-right corner.
 *
 * @param {string} message  - Text to display.
 * @param {'success'|'error'|'info'} [type='info'] - Visual style and colour.
 * @param {number} [duration=5000] - Auto-dismiss delay in ms. Pass 0 to keep open.
 */
export function showToast(message, type = 'info', duration = TOAST_DURATION_MS) {
  const container = ensureContainer();

  const icons = { success: '✔', error: '✕', info: 'ℹ' };
  const icon  = icons[type] ?? icons.info;

  const toast = document.createElement('div');
  toast.className = `lf-toast lf-toast-${type}`;
  // role="alert" + aria-live="assertive" ensures screen readers announce each toast
  toast.setAttribute('role', 'alert');
  toast.setAttribute('aria-live', 'assertive');
  toast.setAttribute('aria-atomic', 'true');

  toast.innerHTML = `
    <em class="lf-toast-icon" aria-hidden="true">${icon}</em>
    <span class="lf-toast-body">${escapeHtml(message)}</span>
    <button class="lf-toast-close" aria-label="Dismiss notification" type="button">✕</button>
  `;

  toast.querySelector('.lf-toast-close').addEventListener('click', () => removeToast(toast));

  container.appendChild(toast);

  if (duration > 0) {
    setTimeout(() => removeToast(toast), duration);
  }
}

// Expose on window so non-module scripts can call window.showToast(...)
if (typeof window !== 'undefined') {
  window.showToast = showToast;
}
