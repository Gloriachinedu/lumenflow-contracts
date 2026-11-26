/* Merchant refunds dashboard
   - Connects to LumenFlowClient SDK in live mode
   - Falls back to mock data in demo mode (no CONTRACT_ID configured)
   - Tabs for Pending / Approved / Rejected / Completed
   - Approve / Reject / Execute wired to real contract calls via Freighter
   - Errors mapped to human-readable messages via ERROR_MESSAGES
   - Dark mode toggle synced with localStorage key 'lumenflow_theme'
   - CSV export of the current filtered view
*/

// ── Constants ─────────────────────────────────────────────────────────────────

/** Base URL for the receipt page, relative to this dashboard's origin.
 *  Adjust if receipt.html lives at a different path. */
const RECEIPT_BASE_URL = (() => {
  const { origin, pathname } = window.location;
  // Derive the frontend root: strip dashboard/merchant-dashboard/ suffix
  const root = pathname.replace(/\/dashboard\/merchant-dashboard\/?.*$/, '');
  return `${origin}${root}/frontend/receipt.html`;
})();

// ── Shared state ──────────────────────────────────────────────────────────────

const state = {
  status: 'pending',  // lowercase to match tab data-status; comparisons are case-insensitive
  refunds: [],        // RefundRecord[]
  wallet: null,  // { type: 'freighter', account: string }
  client: null,  // LumenFlowClient | null
  apiKey: null,  // string | null — per-merchant dashboard API key
};

// ── API key authentication ────────────────────────────────────────────────────

/** localStorage key used to persist the merchant dashboard API key. */
const API_KEY_STORAGE = 'lumenflow_merchant_api_key';

/** Per-key rate limit: 100 requests per 60 s window. */
const RATE_LIMIT_MAX    = 100;
const RATE_LIMIT_WINDOW = 60_000;

/** In-memory rate-limit buckets keyed by API key. */
const rateLimitBuckets = new Map();

/**
 * Returns the stored API key, if any.
 * @returns {string|null}
 */
function getApiKey() {
  if (state.apiKey) return state.apiKey;
  try {
    state.apiKey = localStorage.getItem(API_KEY_STORAGE) || null;
  } catch {
    state.apiKey = null;
  }
  return state.apiKey;
}

/**
 * Persists (or clears) the merchant dashboard API key.
 * @param {string|null} key
 */
function setApiKey(key) {
  state.apiKey = key || null;
  try {
    if (key) localStorage.setItem(API_KEY_STORAGE, key);
    else localStorage.removeItem(API_KEY_STORAGE);
  } catch { /* ignore storage errors */ }
}

/**
 * Builds request headers including the `Authorization: Bearer <key>` header
 * when an API key is configured.
 * @param {Record<string,string>} [extra]
 * @returns {Record<string,string>}
 */
function authHeaders(extra = {}) {
  const headers = { ...extra };
  const key = getApiKey();
  if (key) headers['Authorization'] = `Bearer ${key}`;
  return headers;
}

/**
 * Client-side mirror of the server's per-key rate limiter. Throws a 429-style
 * error when the key exceeds 100 requests per minute.
 * @param {string} key
 */
function enforceRateLimit(key) {
  const now = Date.now();
  let bucket = rateLimitBuckets.get(key);
  if (!bucket || now - bucket.start >= RATE_LIMIT_WINDOW) {
    bucket = { start: now, count: 0 };
    rateLimitBuckets.set(key, bucket);
  }
  bucket.count += 1;
  if (bucket.count > RATE_LIMIT_MAX) {
    const err = new Error('Rate limit exceeded: 100 requests per minute per API key.');
    err.status = 429;
    throw err;
  }
}

/**
 * Authenticated fetch wrapper. Attaches the Bearer header, applies per-key
 * rate limiting, and surfaces 401 (invalid/revoked key) and 429 responses.
 *
 * @param {string} url
 * @param {RequestInit} [options]
 * @returns {Promise<Response>}
 */
async function apiFetch(url, options = {}) {
  const key = getApiKey();
  if (key) enforceRateLimit(key);

  const res = await fetch(url, {
    ...options,
    headers: authHeaders(options.headers || {}),
  });

  if (res.status === 401) {
    showError('API key is invalid or has been revoked. Please re-authenticate.');
    throw Object.assign(new Error('Unauthorized'), { status: 401 });
  }
  if (res.status === 429) {
    showError('Rate limit exceeded (100 requests/min per API key). Please slow down.');
    throw Object.assign(new Error('Too Many Requests'), { status: 429 });
  }
  return res;
}

/**
 * Generates a new API key scoped to a merchant address.
 * Calls `POST /admin/merchant-keys`.
 *
 * @param {string} merchant - Merchant Stellar address the key is scoped to.
 * @returns {Promise<{id:string, key:string, merchant:string}>}
 */
async function createMerchantKey(merchant) {
  const res = await apiFetch('/admin/merchant-keys', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ merchant }),
  });
  if (!res.ok) throw new Error(`Failed to create API key (${res.status})`);
  return res.json();
}

/**
 * Revokes an API key by id.
 * Calls `DELETE /admin/merchant-keys/:id`.
 *
 * @param {string} id
 * @returns {Promise<void>}
 */
async function revokeMerchantKey(id) {
  const res = await apiFetch(`/admin/merchant-keys/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
  if (!res.ok) throw new Error(`Failed to revoke API key (${res.status})`);
}

// ── DOM refs ──────────────────────────────────────────────────────────────────

const accountEl  = document.getElementById('account');
const tableBody  = document.querySelector('#refundsTable tbody');
const emptyEl    = document.getElementById('empty');

// ═══════════════════════════════════════════════════════════════════════════════
//  PAYMENT LINK GENERATOR
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Returns true when the `expires` timestamp encoded in a payment link URL has
 * already passed.
 *
 * @param {string|URL} url - The full payment link URL.
 * @returns {boolean}
 */
function isLinkExpired(url) {
  try {
    const params = new URLSearchParams(typeof url === 'string' ? new URL(url).search : url.search);
    const expires = parseInt(params.get('expires'), 10);
    if (!expires || isNaN(expires)) return false; // no expiry = never expires
    return Date.now() > expires;
  } catch {
    return false;
  }
}

/**
 * Builds a shareable payment URL that pre-fills receipt.html.
 *
 * Encoded parameters:
 *   merchant    – merchant Stellar address
 *   token       – token / asset address
 *   amount      – amount in stroops
 *   order_id    – unique order identifier
 *   memo        – optional payment memo
 *   expires     – Unix timestamp (ms) after which the link is considered expired
 *
 * @param {{merchant:string, token:string, amount:string|number, orderId:string, memo:string, ttlHours:number}} opts
 * @returns {string} The generated URL.
 */
function generatePaymentLink({ merchant, token, amount, orderId, memo, ttlHours }) {
  const ttl = Math.max(1, parseInt(ttlHours, 10) || 24);
  const expires = Date.now() + ttl * 60 * 60 * 1000;

  const params = new URLSearchParams();
  params.set('merchant',  merchant.trim());
  params.set('token',     token.trim());
  params.set('amount',    String(amount).trim());
  params.set('order_id',  orderId.trim());
  if (memo && memo.trim()) params.set('memo', memo.trim());
  params.set('expires',   String(expires));

  return `${RECEIPT_BASE_URL}?${params.toString()}`;
}

// QR code instance — keep a reference so we can clear and re-render
let qrInstance = null;

/**
 * Renders a QR code into #plg-qr using the qrcode.js library loaded from CDN.
 * Falls back to a plain text notice if the library is unavailable.
 *
 * @param {string} url
 */
function renderQRCode(url) {
  const container = document.getElementById('plg-qr');
  container.innerHTML = ''; // clear previous

  if (typeof QRCode === 'undefined') {
    container.textContent = 'QR library not loaded. Please check your internet connection.';
    return;
  }

  qrInstance = new QRCode(container, {
    text:         url,
    width:        192,
    height:       192,
    colorDark:    '#0b1726',
    colorLight:   '#ffffff',
    correctLevel: QRCode.CorrectLevel.M,
  });
}

/**
 * Validates the payment link form and, on success, generates the URL, renders
 * the QR code, and shows the result area.
 */
function handleGenerateLink(e) {
  e.preventDefault();

  const merchant = document.getElementById('plg-merchant').value.trim();
  const token    = document.getElementById('plg-token').value.trim();
  const amount   = document.getElementById('plg-amount').value.trim();
  const orderId  = document.getElementById('plg-order-id').value.trim();
  const memo     = document.getElementById('plg-memo').value.trim();
  const ttlHours = document.getElementById('plg-ttl').value.trim();

  // Basic validation
  const errors = [];
  if (!merchant) errors.push('Merchant address is required.');
  if (!token)    errors.push('Token address is required.');
  if (!amount || isNaN(Number(amount)) || Number(amount) <= 0) errors.push('A positive amount is required.');
  if (!orderId)  errors.push('Order ID is required.');

  if (errors.length) {
    alert(errors.join('\n'));
    return;
  }

  const url = generatePaymentLink({ merchant, token, amount, orderId, memo, ttlHours });

  // Show the result panel
  const resultEl = document.getElementById('plg-result');
  resultEl.hidden = false;

  // Populate the URL textarea
  const outputEl = document.getElementById('plg-url-output');
  outputEl.value = url;

  // Expiry note
  const ttl = Math.max(1, parseInt(ttlHours, 10) || 24);
  const expiresAt = new Date(Date.now() + ttl * 60 * 60 * 1000);
  document.getElementById('plg-expiry-note').textContent =
    `⏱ Expires: ${expiresAt.toLocaleString()} (${ttl} hour${ttl !== 1 ? 's' : ''} from now)`;

  // Render QR code
  renderQRCode(url);

  // Scroll result into view smoothly
  resultEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

/**
 * Copies the generated payment link to the user's clipboard.
 */
function handleCopyLink() {
  const url = document.getElementById('plg-url-output').value;
  if (!url) return;

  const btn = document.getElementById('copyLinkBtn');

  const onSuccess = () => {
    btn.textContent = '✅ Copied!';
    setTimeout(() => { btn.textContent = '📋 Copy Link'; }, 2000);
  };

  const onFailure = () => {
    // Graceful degradation: select the textarea for manual copy
    const ta = document.getElementById('plg-url-output');
    ta.select();
    ta.setSelectionRange(0, 99999);
    try {
      document.execCommand('copy');
      onSuccess();
    } catch {
      prompt('Copy this link manually:', url);
    }
  };

  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(url).then(onSuccess).catch(onFailure);
  } else {
    onFailure();
  }
}

/**
 * Downloads the rendered QR code as a PNG file.
 * The qrcode.js library renders a <canvas> element inside #plg-qr — we grab
 * that canvas, convert it to a data URL, and trigger a browser download.
 */
function handleDownloadQr() {
  const container = document.getElementById('plg-qr');
  const canvas = container.querySelector('canvas');

  if (!canvas) {
    // qrcode.js may render an <img> instead of a <canvas> in some environments
    const img = container.querySelector('img');
    if (img) {
      // Create a temporary canvas to export the image
      const tmpCanvas = document.createElement('canvas');
      tmpCanvas.width  = img.naturalWidth  || img.width  || 192;
      tmpCanvas.height = img.naturalHeight || img.height || 192;
      const ctx = tmpCanvas.getContext('2d');
      ctx.drawImage(img, 0, 0);
      triggerQrDownload(tmpCanvas);
    } else {
      alert('QR code not yet generated. Please generate a payment link first.');
    }
    return;
  }

  triggerQrDownload(canvas);
}

/**
 * Triggers a PNG download from a canvas element.
 * @param {HTMLCanvasElement} canvas
 */
function triggerQrDownload(canvas) {
  const dataUrl = canvas.toDataURL('image/png');
  const link = document.createElement('a');
  link.href = dataUrl;
  link.download = 'lumenflow-payment-qr.png';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

// Wire up payment link form events
document.getElementById('paymentLinkForm').addEventListener('submit', handleGenerateLink);
document.getElementById('copyLinkBtn').addEventListener('click', handleCopyLink);
document.getElementById('downloadQrBtn').addEventListener('click', handleDownloadQr);

// ═══════════════════════════════════════════════════════════════════════════════
//  REFUND MANAGEMENT
// ═══════════════════════════════════════════════════════════════════════════════

/** Show an inline error banner below the tab bar. Clears after 8 s. */
function showError(msg) {
  let banner = document.getElementById('errorBanner');
  if (!banner) {
    banner = document.createElement('div');
    banner.id = 'errorBanner';
    banner.setAttribute('role', 'alert');
    banner.style.cssText = [
      'padding:0.6rem 1rem', 'margin:0.5rem 0',
      'background:#f8d7da', 'color:#58151c',
      'border:1px solid #f1aeb5', 'border-radius:4px',
      'font-size:0.9rem',
    ].join(';');
    const content = document.getElementById('content');
    content.parentNode.insertBefore(banner, content);
  }
  banner.textContent = `⚠ ${msg}`;
  banner.style.display = 'block';
  announce(`Error: ${msg}`);
  clearTimeout(banner._timer);
  banner._timer = setTimeout(() => { banner.style.display = 'none'; }, 8000);
}

// ── Formatting ────────────────────────────────────────────────────────────────
// Token metadata (symbol + decimals) is resolved via the shared helpers in
// frontend/lumenflow-shared.js so USDC renders as "USDC" with 6 decimals and
// native XLM keeps its 7 decimals. See issue #1576.
const sharedTokenHelpers = (typeof window !== 'undefined' && window.LumenFlowShared) || {};

/**
 * Resolve token metadata for a token identifier.
 * Accepts a token address (SAC / contract id) or a symbol like 'XLM' / 'USDC'.
 * Falls back to the native asset when the shared helper is unavailable.
 *
 * @param {string} token
 * @returns {{symbol:string, decimals:number}}
 */
function resolveTokenMetadata(token) {
  if (typeof sharedTokenHelpers.getTokenMetadata === 'function') {
    try {
      const meta = sharedTokenHelpers.getTokenMetadata(token);
      if (meta && meta.symbol) return meta;
    } catch { /* fall through to native defaults */ }
  }
  // Fallback: native XLM metadata
  return { symbol: 'XLM', decimals: 7 };
}

function formatAmount(amount, token) {
  const { symbol, decimals } = resolveTokenMetadata(token || 'native');

  if (typeof sharedTokenHelpers.formatTokenAmount === 'function') {
    try {
      return sharedTokenHelpers.formatTokenAmount(amount, token || 'native');
    } catch { /* fall through to local formatting */ }
  }

  const value = Number(amount) / Math.pow(10, decimals);
  return value.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: decimals,
  }) + ` ${symbol}`;
}

function formatDate(ts) {
  return new Date(Number(ts) * 1000).toLocaleString();
}

function shorten(addr) {
  return addr ? addr.slice(0, 6) + '…' + addr.slice(-4) : '—';
}

// ── Render ────────────────────────────────────────────────────────────────────
function setStatus(status) {
  state.status = status;
  document.querySelectorAll('.tabs .tab').forEach(btn => {
    const selected = btn.dataset.status === status;
    btn.setAttribute('aria-selected', selected ? 'true' : 'false');
    btn.setAttribute('tabindex', selected ? '0' : '-1');
  });
  render();
  announce(`Showing ${status} refunds`);
}

// ── Live region announcements ─────────────────────────────────────────────────
/** Announce a message to screen readers via the polite live region. */
function announce(msg) {
  let region = document.getElementById('a11y-live');
  if (!region) {
    region = document.createElement('div');
    region.id = 'a11y-live';
    region.setAttribute('role', 'status');
    region.setAttribute('aria-live', 'polite');
    region.setAttribute('aria-atomic', 'true');
    region.style.cssText = [
      'position:absolute', 'width:1px', 'height:1px',
      'padding:0', 'margin:-1px', 'overflow:hidden',
      'clip:rect(0,0,0,0)', 'white-space:nowrap', 'border:0',
    ].join(';');
    document.body.appendChild(region);
  }
  // Clear then set so repeated identical messages are re-announced
  region.textContent = '';
  setTimeout(() => { region.textContent = msg; }, 50);
}

function render() {
  // Normalise to lowercase for comparison because demo data uses RefundStatus
  // enum strings (capitalised) and the contract returns the same strings.
  const rows = state.refunds.filter(
    r => (r.status || '').toLowerCase() === (state.status || '').toLowerCase()
  );
  tableBody.innerHTML = '';

  if (!rows.length) {
    emptyEl.style.display = 'block';
    tableEl.style.display = 'none';
    return;
  }
  emptyEl.style.display = 'none';
  tableEl.style.display = 'table';

  rows.forEach(r => {
    const tr = document.createElement('tr');
    const dateStr = r.createdAt ? formatDate(r.createdAt) : '—';
    const amtStr  = formatAmount(r.amount, r.token || 'native');
    tr.innerHTML = `
      <td>${r.refundId}</td>
      <td title="${r.initiator || ''}">${shorten(r.initiator)}</td>
      <td>${amtStr}</td>
      <td>${r.status}</td>
      <td>${dateStr}</td>
      <td></td>
    `;
    const actions = tr.querySelector('td:last-child');
    const label = r.refundId || r.id;
    if (r.status === 'pending') {
      const approve = document.createElement('button');
      approve.type = 'button';
      approve.textContent = 'Approve';
      approve.setAttribute('aria-label', `Approve refund ${label}`);
      const reject = document.createElement('button');
      reject.type = 'button';
      reject.textContent = 'Reject';
      reject.setAttribute('aria-label', `Reject refund ${label}`);
      approve.addEventListener('click', () => confirmAction('approve', r.id));
      reject.addEventListener('click',  () => confirmAction('reject',  r.id));
      actions.appendChild(approve); actions.appendChild(reject);
    } else if (r.status === 'approved') {
      const execute = document.createElement('button');
      execute.type = 'button';
      execute.textContent = 'Execute';
      execute.setAttribute('aria-label', `Execute refund ${label}`);
      execute.addEventListener('click', () => confirmAction('execute', r.id));
      actions.appendChild(execute);
    }
    tableBody.appendChild(tr);
  });
}

function confirmAction(action, id) {
  const modal = document.getElementById('confirmModal');
  const text  = document.getElementById('confirmText');
  text.textContent = `Confirm ${action} for refund ${id}?`;
  openModal(modal);
  document.getElementById('confirmYes').onclick = async () => {
    closeModal(modal);
    if (action === 'approve') updateStatus(id, 'approved');
    if (action === 'reject')  updateStatus(id, 'rejected');
    if (action === 'execute') await executeRefund(id);
  };
}

function updateStatus(id, newStatus) {
  const r = state.refunds.find(x => x.id === id);
  if (r) r.status = newStatus;
  render();
  announce(`Refund ${id} marked ${newStatus}`);
}

async function executeRefund(id) {
  if (!state.wallet) {
    alert('Please connect a wallet first');
    return;
  }
  try {
    if (state.wallet.type === 'freighter' && window.freighter) {
      await window.freighter.signTransaction({ memo: `refund:${id}` });
    } else if (state.wallet.type === 'albedo') {
      await window.albedo.sign({ memo: `refund:${id}` });
    } else {
      console.warn('No wallet adapter present, simulate execute');
    }
    updateStatus(id, 'completed');
  } catch (e) {
    console.error(e);
    alert('Failed to execute refund');
  }
}

// ── Modal helpers ─────────────────────────────────────────────────────────────

function openModal(modal) {
  if (!modal) return;
  modal.style.display = 'block';
  modal.setAttribute('aria-hidden', 'false');
  modal.setAttribute('aria-modal', 'true');
  if (!modal.hasAttribute('role')) modal.setAttribute('role', 'dialog');
  trapFocus(modal);
}

function closeModal(modal) {
  if (!modal) return;
  modal.style.display = 'none';
  modal.setAttribute('aria-hidden', 'true');
  releaseFocusTrap();
}

let lastFocused  = null;
let trapListener = null;
function trapFocus(modal) {
  lastFocused = document.activeElement;
  const focusable = Array.from(
    modal.querySelectorAll(
      'button:not([disabled]),[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])'
    )
  ).filter(el => el.offsetParent !== null || el === document.activeElement);
  const first = focusable[0];
  const last  = focusable[focusable.length - 1];
  if (first) first.focus();
  trapListener = (e) => {
    if (e.key === 'Tab') {
      if (!focusable.length) { e.preventDefault(); return; }
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault(); last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault(); first.focus();
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      closeModal(modal);
    }
  };
  document.addEventListener('keydown', trapListener);
}

function releaseFocusTrap() {
  if (trapListener) document.removeEventListener('keydown', trapListener);
  trapListener = null;
  if (lastFocused && typeof lastFocused.focus === 'function') lastFocused.focus();
  lastFocused = null;
}

// ── Wallet connect handlers ───────────────────────────────────────────────────

document.getElementById('connectWallet').addEventListener('click', () => openModal(document.getElementById('walletModal')));
document.getElementById('walletClose').addEventListener('click', () => closeModal(document.getElementById('walletModal')));

document.getElementById('freighter').addEventListener('click', async () => {
  closeModal(document.getElementById('walletModal'));
  if (window.freighter) {
    try {
      const resp = await window.freighter.getConnectedAccount();
      state.wallet = { type: 'freighter', account: resp.publicKey };
      localStorage.setItem('wallet', JSON.stringify(state.wallet));
      accountEl.textContent = shorten(resp.publicKey);
      // Pre-fill merchant address field if it's empty
      const merchantInput = document.getElementById('plg-merchant');
      if (!merchantInput.value) merchantInput.value = resp.publicKey;
    } catch (e) { alert('Freighter not available'); }
  } else { alert('Freighter not installed'); }
});

document.getElementById('albedo').addEventListener('click', async () => {
  closeModal(document.getElementById('walletModal'));
  if (window.albedo) {
    try {
      const resp = await window.albedo.publicKey();
      state.wallet = { type: 'albedo', account: resp };
      localStorage.setItem('wallet', JSON.stringify(state.wallet));
      accountEl.textContent = shorten(resp);
      const merchantInput = document.getElementById('plg-merchant');
      if (!merchantInput.value) merchantInput.value = resp;
    } catch (e) { alert('Albedo connect failed'); }
  } else { alert('Albedo not available'); }
});

function shorten(a) { return a ? a.slice(0, 6) + '…' + a.slice(-4) : '—'; }

// ── Refund tabs ───────────────────────────────────────────────────────────────

document.querySelectorAll('.tabs .tab').forEach(btn =>
  btn.addEventListener('click', () => setStatus(btn.dataset.status))
);

// Keyboard support for the tablist: Arrow keys move focus, Home/End jump.
(function initTabKeyboard() {
  const tabs = Array.from(document.querySelectorAll('.tabs .tab'));
  if (!tabs.length) return;
  const tablist = tabs[0].parentElement;
  if (tablist && !tablist.hasAttribute('role')) tablist.setAttribute('role', 'tablist');

  tabs.forEach((btn, i) => {
    if (!btn.hasAttribute('role')) btn.setAttribute('role', 'tab');
    btn.setAttribute('tabindex', btn.getAttribute('aria-selected') === 'true' ? '0' : '-1');
    btn.addEventListener('keydown', (e) => {
      let target = null;
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
        target = tabs[(i + 1) % tabs.length];
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
        target = tabs[(i - 1 + tabs.length) % tabs.length];
      } else if (e.key === 'Home') {
        target = tabs[0];
      } else if (e.key === 'End') {
        target = tabs[tabs.length - 1];
      } else if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        setStatus(btn.dataset.status);
        return;
      }
      if (target) {
        e.preventDefault();
        target.focus();
        setStatus(target.dataset.status);
      }
    });
  });
})();

// ── Mock fetch — replace with real API/EventSource in production ──────────────

  const caller = state.wallet.account;

// Mock fetch — in real app call backend API or use streaming (EventSource)
async function fetchMockRefunds() {
  const now = Date.now();
  state.refunds = [
    {
      id: 'r1',
      order_id: 'ORDER_001',
      customer: 'Alice',
      amount: 10000000,
      token: 'XLM',
      status: 'pending',
      refunded_amount: 0,
      platform_fee: 25000,
      memo: 'Invoice #001',
      date: new Date(now - 86400000 * 2).toISOString(),
    },
    {
      id: 'r2',
      order_id: 'ORDER_002',
      customer: 'Bob',
      amount: 5000000,
      token: 'XLM',
      status: 'approved',
      refunded_amount: 0,
      platform_fee: 12500,
      memo: 'Invoice #002',
      date: new Date(now - 86400000).toISOString(),
    },
    {
      id: 'r3',
      order_id: 'ORDER_003',
      customer: 'Carol',
      amount: 20000000,
      token: 'USDC',
      status: 'completed',
      refunded_amount: 5000000,
      platform_fee: 50000,
      memo: 'Invoice "special" order',
      date: new Date(now - 86400000 * 5).toISOString(),
    },
    {
      id: 'r4',
      order_id: 'ORDER_004',
      customer: 'Dave',
      amount: 3000000,
      token: 'XLM',
      status: 'rejected',
      refunded_amount: 0,
      platform_fee: 7500,
      memo: '',
      date: new Date(now - 86400000 * 3).toISOString(),
    },
  ];
  render();
}

// ── Freighter signer factory ──────────────────────────────────────────────────
/**
 * Wraps window.freighter.signTransaction into the SDK Signer shape:
 *   (tx: Transaction) => Promise<Transaction>
 *
 * Freighter's signTransaction accepts an XDR string and returns a signed XDR
 * string, so we serialise / deserialise around the call.
 */
function buildFreighterSigner() {
  return async (tx) => {
    const freighter = window.freighter;
    if (!freighter) throw new Error('Freighter extension is not installed.');
    // freighter.signTransaction expects the XDR envelope string
    const signedXdr = await freighter.signTransaction(tx.toEnvelope().toXDR('base64'), {
      network: NETWORK,
      networkPassphrase: NETWORK_PASSPHRASE,
    });
    // Re-hydrate the signed transaction from XDR
    // Using stellar-sdk TransactionBuilder.fromXDR via dynamic import
    const { TransactionBuilder } = await import('https://cdn.jsdelivr.net/npm/@stellar/stellar-sdk@12/dist/stellar-sdk.min.js');
    return TransactionBuilder.fromXDR(signedXdr, NETWORK_PASSPHRASE);
  };
}

// ── Data fetching ─────────────────────────────────────────────────────────────
/**
 * Fetch pending refunds for the connected merchant.
 *
 * Strategy:
 *  1. Demo mode → use local mock data.
 *  2. Live mode, wallet connected → call getMerchantPaymentHistory to get
 *     orders, then getRefundsForOrder on each to collect all refund records.
 *  3. Live mode, no wallet → show empty list.
 */
async function fetchRefunds() {
  if (DEMO_MODE || !state.client) {
    if (!state.refunds.length) {
      // Populate mock data once
      state.refunds = buildMockRefunds();
    }
    render();
    return;
  }

  if (!state.wallet) {
    render();
    return;
  }

  const merchant = state.wallet.account;

  // Require an API key scoped to this merchant before querying the dashboard API.
  const apiKey = getApiKey();
  if (!apiKey) {
    showError('No merchant API key configured. Generate one via POST /admin/merchant-keys.');
    render();
    return;
  }

  try {
    // 1. Fetch recent orders for this merchant (authenticated via Bearer key)
    const page = await apiFetch(
      `/dashboard/merchants/${encodeURIComponent(merchant)}/payments?limit=50`
    ).then(res => {
      if (!res.ok) throw new Error(`Failed to load payments (${res.status})`);
      return res.json();
    });

    const orders = page.payments || [];

    // 2. For each order, fetch its associated refunds
    const refundLists = await Promise.all(
      orders.map(order =>
        apiFetch(
          `/dashboard/merchants/${encodeURIComponent(merchant)}/orders/${encodeURIComponent(order.orderId)}/refunds`
        )
          .then(res => (res.ok ? res.json() : []))
          .catch(() => [])
      )
    );

    // Flatten and deduplicate by refundId
    const seen = new Set();
    const all = [];
    for (const list of refundLists) {
      for (const r of list) {
        if (!seen.has(r.refundId)) {
          seen.add(r.refundId);
          all.push(r);
        }
      }
    }

    state.refunds = all;
    render();
  } catch (err) {
    if (err && (err.status === 401 || err.status === 429)) return; // already surfaced
    showError(friendlyError(err));
  }
}

// ── Wallet connect handlers ───────────────────────────────────────────────────
function applyWallet(info) {
  state.wallet = info;
  localStorage.setItem('wallet', JSON.stringify(info));
  accountEl.textContent = shorten(info.account);

  // Build SDK client with the Freighter signer
  if (!DEMO_MODE) {
    const signer = info.type === 'freighter' ? buildFreighterSigner() : null;
    state.client = new LumenFlowClient({
      contractId: CONTRACT_ID,
      rpcUrl: RPC_URL,
      networkPassphrase: NETWORK_PASSPHRASE,
      signer,
    });
  }

  // Refresh data for the newly connected wallet
  fetchRefunds();
}

document.getElementById('connectWallet').addEventListener('click', () =>
  openModal(document.getElementById('walletModal'))
);
document.getElementById('walletClose').addEventListener('click', () =>
  closeModal(document.getElementById('walletModal'))
);

document.getElementById('freighter').addEventListener('click', async () => {
  closeModal(document.getElementById('walletModal'));
  if (!window.freighter) {
    showError('Freighter extension is not installed. Visit https://www.freighter.app/');
    return;
  }
  try {
    const resp = await window.freighter.getConnectedAccount();
    applyWallet({ type: 'freighter', account: resp.publicKey });
  } catch (e) {
    showError(`Freighter connection failed: ${friendlyError(e)}`);
  }
});

document.getElementById('albedo').addEventListener('click', async () => {
  closeModal(document.getElementById('walletModal'));
  if (!window.albedo) {
    showError('Albedo is not available. Please install or enable it.');
    return;
  }
  try {
    const resp = await window.albedo.publicKey();
    applyWallet({ type: 'albedo', account: resp.publicKey || resp });
  } catch (e) {
    showError(`Albedo connection failed: ${friendlyError(e)}`);
  }
});

// ── Tabs ──────────────────────────────────────────────────────────────────────
document.querySelectorAll('.tabs .tab').forEach(btn =>
  btn.addEventListener('click', () => setStatus(btn.dataset.status))
);

// Keyboard support for the tablist: Arrow keys move focus, Home/End jump.
(function initTabKeyboard() {
  const tabs = Array.from(document.querySelectorAll('.tabs .tab'));
  if (!tabs.length) return;
  const tablist = tabs[0].parentElement;
  if (tablist && !tablist.hasAttribute('role')) tablist.setAttribute('role', 'tablist');

  tabs.forEach((btn, i) => {
    if (!btn.hasAttribute('role')) btn.setAttribute('role', 'tab');
    btn.setAttribute('tabindex', btn.getAttribute('aria-selected') === 'true' ? '0' : '-1');
    btn.addEventListener('keydown', (e) => {
      let target = null;
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
        target = tabs[(i + 1) % tabs.length];
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
        target = tabs[(i - 1 + tabs.length) % tabs.length];
      } else if (e.key === 'Home') {
        target = tabs[0];
      } else if (e.key === 'End') {
        target = tabs[tabs.length - 1];
      } else if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        setStatus(btn.dataset.status);
        return;
      }
      if (target) {
        e.preventDefault();
        target.focus();
        setStatus(target.dataset.status);
      }
    });
  });
})();

// ── CSV export ────────────────────────────────────────────────────────────────
function csvEscape(value) {
  const str = value == null ? '' : String(value);
  return '"' + str.replace(/"/g, '""') + '"';
}

function exportToCsv() {
  const rows = state.refunds.filter(
    r => (r.status || '').toLowerCase() === (state.status || '').toLowerCase()
  );
  const dates  = rows.map(r => r.createdAt ? formatDate(r.createdAt) : '').filter(Boolean).sort();
  const from   = dates.length ? dates[0].slice(0, 10)             : 'unknown';
  const to     = dates.length ? dates[dates.length - 1].slice(0, 10) : 'unknown';
  const prefix = state.wallet ? state.wallet.account.slice(0, 6) : 'noaddr';
  const filename = `lumenflow-${prefix}-${from}-${to}.csv`;

  const header = ['refund_id', 'order_id', 'initiator', 'amount', 'status', 'reason', 'created_at'];
  const lines  = [header.join(',')];
  rows.forEach(r => {
    lines.push([
      csvEscape(r.refundId),
      csvEscape(r.orderId),
      csvEscape(r.initiator),
      csvEscape(r.amount),
      csvEscape(r.status),
      csvEscape(r.reason),
      csvEscape(r.createdAt ? formatDate(r.createdAt) : ''),
    ].join(','));
  });

  const blob = new Blob([lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href  = url;
  link.setAttribute('download', filename);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

// Poll every 10s
fetchRefunds();
setInterval(fetchRefunds, 10000);

// ── Restore wallet from localStorage ─────────────────────────────────────────

const saved = localStorage.getItem('wallet');
if (saved) {
  try {
    state.wallet = JSON.parse(saved);
    accountEl.textContent = shorten(state.wallet.account);
    // Pre-fill merchant field from saved wallet
    const merchantInput = document.getElementById('plg-merchant');
    if (!merchantInput.value && state.wallet.account) {
      merchantInput.value = state.wallet.account;
    }
  } catch (e) { /* ignore */ }
}

// ── Dark mode ─────────────────────────────────────────────────────────────────
function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem('lumenflow_theme', theme);
  const btn = document.getElementById('themeToggle');
  if (btn) {
    btn.textContent = theme === 'dark' ? '☀️ Light' : '🌙 Dark';
    btn.setAttribute('aria-label', theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme');
    btn.setAttribute('aria-pressed', theme === 'dark' ? 'true' : 'false');
  }
}

const themeToggleBtn = document.getElementById('themeToggle');
if (themeToggleBtn) {
  themeToggleBtn.addEventListener('click', () => {
    const current = document.documentElement.getAttribute('data-theme') || 'light';
    applyTheme(current === 'dark' ? 'light' : 'dark');
  });
  const initialTheme = document.documentElement.getAttribute('data-theme') || 'light';
  themeToggleBtn.textContent = initialTheme === 'dark' ? '☀️ Light' : '🌙 Dark';
  themeToggleBtn.setAttribute('aria-label', initialTheme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme');
  themeToggleBtn.setAttribute('aria-pressed', initialTheme === 'dark' ? 'true' : 'false');
}

// ── Health badge ──────────────────────────────────────────────────────────────
/**
 * Polls the backend `/health` endpoint and reflects dependency status in the
 * dashboard badge. The badge shows green when all dependencies are healthy,
 * amber/red when any are degraded, and grey when the status is unknown.
 */
const HEALTH_ENDPOINT = '/health';
const HEALTH_POLL_INTERVAL_MS = 15_000;

function renderHealthBadge(health) {
  const badge = document.getElementById('healthBadge');
  if (!badge) return;

  const deps = [
    ['rpc', health && health.rpc],
    ['redis', health && health.redis],
    ['webhookRelay', health && health.webhookRelay],
  ];

  const known = deps.filter(([, dep]) => dep && typeof dep.ok === 'boolean');
  const allOk = known.length === deps.length && known.every(([, dep]) => dep.ok);

  let label = 'Unknown';
  let color = '#6c757d';
  if (known.length) {
    if (allOk) {
      label = 'Healthy';
      color = '#1a7f37';
    } else {
      label = 'Degraded';
      color = '#b02a37';
    }
  }

  badge.textContent = `● ${label}`;
  badge.style.color = color;
  badge.dataset.status = allOk ? 'healthy' : (known.length ? 'degraded' : 'unknown');

  const lines = deps.map(([name, dep]) => {
    if (!dep) return `${name}: unknown`;
    const parts = [`ok=${dep.ok}`];
    if (typeof dep.latency_ms === 'number') parts.push(`${dep.latency_ms}ms`);
    return `${name}: ${parts.join(' ')}`;
  });
  badge.title = lines.join('\n');
}

async function refreshHealth() {
  try {
    const resp = await fetch(HEALTH_ENDPOINT, {
      headers: { Accept: 'application/json' },
      cache: 'no-store',
    });
    let body = null;
    try { body = await resp.json(); } catch { /* non-JSON response */ }
    renderHealthBadge(body);
  } catch {
    renderHealthBadge(null);
  }
}

refreshHealth();
setInterval(refreshHealth, HEALTH_POLL_INTERVAL_MS);

// ── Demo / live mode banner ───────────────────────────────────────────────────
(function renderModeBanner() {
  const banner = document.createElement('div');
  banner.id = 'lf-mode-banner';
  banner.setAttribute('role', 'status');
  banner.style.cssText = [
    'position:sticky', 'top:0', 'z-index:1000',
    'padding:0.4rem 1rem', 'font-size:0.8rem', 'font-weight:600', 'text-align:center',
    DEMO_MODE
      ? 'background:#fff3cd;color:#856404;'
      : 'background:#d1f3e0;color:#1a5e37;',
  ].join(';');
  banner.textContent = DEMO_MODE
    ? '⚠ Demo mode – displaying mock data. Set LUMENFLOW_CONTRACT_ID to connect to a live contract.'
    : `✔ Live mode – connected to contract ${CONTRACT_ID.slice(0, 8)}… on ${NETWORK}.`;
  document.body.prepend(banner);
})();

// ── Accessibility: ensure the live region exists on load ─────────────────────
announce('Merchant dashboard loaded');

// ── Initialise ────────────────────────────────────────────────────────────────

// Restore wallet from localStorage (e.g. page refresh)
const savedWallet = localStorage.getItem('wallet');
if (savedWallet) {
  try {
    const info = JSON.parse(savedWallet);
    state.wallet = info;
    accountEl.textContent = shorten(info.account);
    if (!DEMO_MODE && info.type === 'freighter') {
      state.client = new LumenFlowClient({
        contractId: CONTRACT_ID,
        rpcUrl: RPC_URL,
        networkPassphrase: NETWORK_PASSPHRASE,
        signer: buildFreighterSigner(),
      });
    }
  } catch (e) { /* ignore corrupt storage */ }
}

// Initial fetch + poll every 30 s
fetchRefunds();
setInterval(fetchRefunds, 30_000);

// ── API key management UI ─────────────────────────────────────────────────────
(function initApiKeyUi() {
  const form = document.getElementById('apiKeyForm');
  if (!form) return;

  const input   = document.getElementById('apiKeyMerchant');
  const statusEl = document.getElementById('apiKeyStatus');

  // Pre-fill merchant address from the connected wallet
  if (state.wallet && state.wallet.account && input && !input.value) {
    input.value = state.wallet.account;
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const merchant = (input && input.value.trim()) || (state.wallet && state.wallet.account);
    if (!merchant) {
      showError('A merchant address is required to generate an API key.');
      return;
    }
    try {
      const created = await createMerchantKey(merchant);
      setApiKey(created.key);
      if (statusEl) {
        statusEl.textContent = `✔ API key ${created.id} created for ${shorten(created.merchant || merchant)}.`;
      }
      fetchRefunds();
    } catch (err) {
      showError(err.message || 'Failed to generate API key.');
    }
  });

  const revokeBtn = document.getElementById('apiKeyRevoke');
  if (revokeBtn) {
    revokeBtn.addEventListener('click', async () => {
      const id = (document.getElementById('apiKeyId') || {}).value;
      if (!id) {
        showError('Enter the API key id to revoke.');
        return;
      }
      try {
        await revokeMerchantKey(id.trim());
        setApiKey(null);
        if (statusEl) statusEl.textContent = `✔ API key ${id} revoked.`;
      } catch (err) {
        showError(err.message || 'Failed to revoke API key.');
      }
    });
  }
})();
