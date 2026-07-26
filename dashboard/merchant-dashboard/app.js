/* Minimal merchant refunds UI logic
   - Tabs for statuses
   - Approve / Reject with confirm modal
   - Execute (calls wallet if connected)
   - Wallet modal with Freighter / Albedo handlers
   - Polling for updates (mocked fetch)
   - Dark mode toggle synced with localStorage key 'lumenflow_theme'
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
  status: 'pending',
  refunds: [],
  wallet: null,
};

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

// Wire up payment link form events
document.getElementById('paymentLinkForm').addEventListener('submit', handleGenerateLink);
document.getElementById('copyLinkBtn').addEventListener('click', handleCopyLink);

// ═══════════════════════════════════════════════════════════════════════════════
//  REFUND MANAGEMENT
// ═══════════════════════════════════════════════════════════════════════════════

function setStatus(status) {
  state.status = status;
  document.querySelectorAll('.tabs .tab').forEach(btn => {
    const s = btn.dataset.status;
    btn.setAttribute('aria-selected', s === status);
  });
  render();
}

function render() {
  const rows = state.refunds.filter(r => r.status === state.status);
  tableBody.innerHTML = '';
  if (!rows.length) {
    emptyEl.style.display = 'block';
    document.getElementById('refundsTable').style.display = 'none';
    return;
  }
  emptyEl.style.display = 'none';
  document.getElementById('refundsTable').style.display = 'table';
  rows.forEach(r => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${r.id}</td>
      <td>${r.customer}</td>
      <td>${r.amount}</td>
      <td>${r.status}</td>
      <td></td>
    `;
    const actions = tr.querySelector('td:last-child');
    if (r.status === 'pending') {
      const approve = document.createElement('button'); approve.textContent = 'Approve';
      const reject  = document.createElement('button'); reject.textContent  = 'Reject';
      approve.addEventListener('click', () => confirmAction('approve', r.id));
      reject.addEventListener('click',  () => confirmAction('reject',  r.id));
      actions.appendChild(approve); actions.appendChild(reject);
    } else if (r.status === 'approved') {
      const execute = document.createElement('button'); execute.textContent = 'Execute';
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
  modal.style.display = 'block';
  modal.setAttribute('aria-hidden', 'false');
  trapFocus(modal);
}
function closeModal(modal) {
  modal.style.display = 'none';
  modal.setAttribute('aria-hidden', 'true');
  releaseFocusTrap();
}

let lastFocused  = null;
let trapListener = null;
function trapFocus(modal) {
  lastFocused = document.activeElement;
  const focusable = modal.querySelectorAll('button,[href],input,select,textarea,[tabindex]:not([tabindex="-1"])');
  const first = focusable[0];
  const last  = focusable[focusable.length - 1];
  first && first.focus();
  trapListener = (e) => {
    if (e.key === 'Tab') {
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault(); last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault(); first.focus();
      }
    } else if (e.key === 'Escape') {
      closeModal(modal);
    }
  };
  document.addEventListener('keydown', trapListener);
}
function releaseFocusTrap() {
  document.removeEventListener('keydown', trapListener);
  trapListener = null;
  lastFocused && lastFocused.focus();
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

// ── Mock fetch — replace with real API/EventSource in production ──────────────

// Export CSV
document.getElementById('exportCsv').addEventListener('click', exportToCsv);

// Mock fetch — in real app call backend API or use streaming (EventSource)
async function fetchRefunds() {
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

/**
 * Escape a field value for CSV output.
 * Wraps the value in double-quotes and escapes any existing double-quotes
 * by doubling them, per RFC 4180.
 */
function csvEscape(value) {
  const str = value == null ? '' : String(value);
  // Always quote the field so commas and newlines in memos are safe
  return '"' + str.replace(/"/g, '""') + '"';
}

/**
 * Export the currently filtered refund list to a CSV file and trigger a download.
 * Filename: lumenflow-{addrPrefix}-{from}-{to}.csv
 */
function exportToCsv() {
  const rows = state.refunds.filter(r => r.status === state.status);

  // Determine date range from the filtered rows
  const dates = rows.map(r => r.date).filter(Boolean).sort();
  const from = dates.length ? dates[0].slice(0, 10) : 'unknown';
  const to   = dates.length ? dates[dates.length - 1].slice(0, 10) : 'unknown';

  const addrPrefix = state.wallet ? state.wallet.account.slice(0, 6) : 'noaddr';
  const filename = `lumenflow-${addrPrefix}-${from}-${to}.csv`;

  const header = ['order_id', 'date', 'amount', 'token', 'status', 'refunded_amount', 'platform_fee', 'memo'];
  const lines = [header.join(',')];

  rows.forEach(r => {
    const line = [
      csvEscape(r.order_id),
      csvEscape(r.date),
      csvEscape(r.amount),
      csvEscape(r.token),
      csvEscape(r.status),
      csvEscape(r.refunded_amount),
      csvEscape(r.platform_fee),
      csvEscape(r.memo),
    ].join(',');
    lines.push(line);
  });

  const csvContent = lines.join('\r\n');
  const blob = new Blob([csvContent], {type: 'text/csv;charset=utf-8;'});
  const url = URL.createObjectURL(blob);

  const link = document.createElement('a');
  link.href = url;
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
  // Use the same key as the main frontend so preferences are shared
  localStorage.setItem('lumenflow_theme', theme);
  const btn = document.getElementById('themeToggle');
  if (btn) btn.textContent = theme === 'dark' ? '☀️ Light' : '🌙 Dark';
}

const themeToggleBtn = document.getElementById('themeToggle');
if (themeToggleBtn) {
  themeToggleBtn.addEventListener('click', () => {
    const current = document.documentElement.getAttribute('data-theme') || 'light';
    applyTheme(current === 'dark' ? 'light' : 'dark');
  });

  // Sync button label with initial theme set by the inline script
  const initialTheme = document.documentElement.getAttribute('data-theme') || 'light';
  themeToggleBtn.textContent = initialTheme === 'dark' ? '☀️ Light' : '🌙 Dark';
}
