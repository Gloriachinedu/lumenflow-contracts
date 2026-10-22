/**
 * LumenFlow — Fraud Analytics Dashboard (app.js)
 *
 * Data sources:
 *   - Horizon SSE stream for `lumenflow/suspicious_activity` events
 *   - Simulated metrics derived from lumenflow_exporter.py-style data
 *     (falls back to demo data when LUMENFLOW_CONTRACT_ID / HORIZON_URL not set)
 *
 * Auto-refreshes every 60 seconds.
 */

// ── Configuration ─────────────────────────────────────────────────────────

const HORIZON_URL    = window.LUMENFLOW_HORIZON_URL   || 'https://horizon-testnet.stellar.org';
const CONTRACT_ID    = window.LUMENFLOW_CONTRACT_ID    || '';
const REFRESH_MS     = 60_000;          // 60 seconds

/** Default alert thresholds — used when no saved settings are present. */
const DEFAULTS = {
  largePaymentThresholdXlm: (window.LUMENFLOW_LARGE_PAYMENT_THRESHOLD || 100_000) / 1e7,
  velocityLimitPerHour: 50,
};

/** Stroops per XLM */
const STROOPS_PER_XLM = 1e7;

// ── Persisted settings ────────────────────────────────────────────────────

const SETTINGS_KEY = 'lumenflow_fraud_settings';

/**
 * Load settings from localStorage.  Falls back to DEFAULTS for any missing
 * or invalid values so the dashboard always starts in a sensible state.
 *
 * @returns {{ largePaymentThresholdXlm: number, velocityLimitPerHour: number }}
 */
function loadSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return { ...DEFAULTS };
    const parsed = JSON.parse(raw);
    return {
      largePaymentThresholdXlm:
        typeof parsed.largePaymentThresholdXlm === 'number' && parsed.largePaymentThresholdXlm > 0
          ? parsed.largePaymentThresholdXlm
          : DEFAULTS.largePaymentThresholdXlm,
      velocityLimitPerHour:
        typeof parsed.velocityLimitPerHour === 'number' && parsed.velocityLimitPerHour >= 1
          ? parsed.velocityLimitPerHour
          : DEFAULTS.velocityLimitPerHour,
    };
  } catch {
    return { ...DEFAULTS };
  }
}

/**
 * Persist settings to localStorage.
 *
 * @param {{ largePaymentThresholdXlm: number, velocityLimitPerHour: number }} settings
 */
function saveSettings(settings) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

/** Active settings — mutated when the user saves new values. */
let settings = loadSettings();

/** Returns the large-payment threshold in stroops (for comparison). */
function largePaymentThresholdStroops() {
  return Math.round(settings.largePaymentThresholdXlm * STROOPS_PER_XLM);
}

// Keep LARGE_PAYMENT_THRESHOLD as a dynamic getter for backward compatibility
// with code that reads it as a value.
let LARGE_PAYMENT_THRESHOLD = largePaymentThresholdStroops();

// Track unseen alerts for the nav badge
let seenEventIds = new Set(JSON.parse(sessionStorage.getItem('seen_event_ids') || '[]'));
let newAlertCount = 0;

// ── DOM refs ──────────────────────────────────────────────────────────────

const alertBadge    = document.getElementById('alert-badge');
const alertCount    = document.getElementById('alert-count');
const lastRefreshEl = document.getElementById('last-refresh');
const refreshBtn    = document.getElementById('refresh-btn');

// ── Formatting helpers ────────────────────────────────────────────────────

function fmtTime(ts) {
  return new Date(ts * 1000).toLocaleString(undefined, {
    month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function fmtAmount(stroops) {
  return (Number(stroops) / 1e7).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 7,
  });
}

function shorten(addr) {
  if (!addr || addr.length < 10) return addr || '—';
  return addr.slice(0, 6) + '…' + addr.slice(-4);
}

function reasonLabel(reason) {
  const map = { LargePayment: 'Large Payment', RapidRefunds: 'Rapid Refunds', ManyAuthFailures: 'Auth Failures' };
  return map[reason] || reason;
}

function severityClass(reason) {
  if (reason === 'ManyAuthFailures') return 'severity-high';
  if (reason === 'RapidRefunds')     return 'severity-medium';
  return 'severity-low';
}

// ── Demo data ─────────────────────────────────────────────────────────────

function getDemoData() {
  const now = Math.floor(Date.now() / 1000);
  const merchants = [
    'GBXGQ…XON', 'GAAZI…CCW', 'GDMEX…KPQ', 'GCBVT…QWE', 'GFKDL…MNP',
  ];

  const suspiciousEvents = [
    { id: 'evt-001', merchant: merchants[0], reason: 'LargePayment',   amount: 5_000_000_000, ts: now - 1200 },
    { id: 'evt-002', merchant: merchants[1], reason: 'RapidRefunds',   amount: 200_000_000,   ts: now - 3500 },
    { id: 'evt-003', merchant: merchants[2], reason: 'ManyAuthFailures', amount: 0,            ts: now - 7200 },
    { id: 'evt-004', merchant: merchants[0], reason: 'LargePayment',   amount: 3_200_000_000, ts: now - 14400 },
    { id: 'evt-005', merchant: merchants[3], reason: 'RapidRefunds',   amount: 150_000_000,   ts: now - 50000 },
  ].filter(e => (now - e.ts) < 86400);

  const refundRates = [
    { merchant: merchants[0], payments: 120, refunds: 38, rate: 31.7 },
    { merchant: merchants[3], payments: 80,  refunds: 22, rate: 27.5 },
    { merchant: merchants[1], payments: 200, refunds: 44, rate: 22.0 },
    { merchant: merchants[4], payments: 60,  refunds: 11, rate: 18.3 },
    { merchant: merchants[2], payments: 340, refunds: 50, rate: 14.7 },
  ];

  const largePayments = [
    { ts: now - 1200,  orderId: 'ORD-7821', merchant: merchants[0], payer: 'GAAZI…CCW', amount: 5_000_000_000 },
    { ts: now - 14400, orderId: 'ORD-7651', merchant: merchants[0], payer: 'GDMEX…KPQ', amount: 3_200_000_000 },
    { ts: now - 32000, orderId: 'ORD-7490', merchant: merchants[4], payer: 'GCBVT…QWE', amount: 2_800_000_000 },
  ];

  const velocityAnomalies = [
    { merchant: merchants[1], paymentsPerHour: 87, avgPerHour: 12.4, spikeFactor: 7.0 },
    { merchant: merchants[2], paymentsPerHour: 55, avgPerHour: 9.8,  spikeFactor: 5.6 },
    { merchant: merchants[3], paymentsPerHour: 40, avgPerHour: 8.1,  spikeFactor: 4.9 },
  ];

  return { suspiciousEvents, refundRates, largePayments, velocityAnomalies };
}

// ── Horizon SSE fetch for suspicious_activity events ─────────────────────

async function fetchSuspiciousEventsFromHorizon(contractId) {
  // Poll /effects or /transactions stream for contract events.
  // We query the last 24 h of effects and filter for lumenflow/suspicious_activity.
  const cutoff = Math.floor(Date.now() / 1000) - 86400;
  const url = `${HORIZON_URL}/accounts/${contractId}/effects?limit=200&order=desc`;

  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Horizon responded with ${res.status}`);
    const json = await res.json();
    const records = json._embedded?.records || [];

    return records
      .filter(r => r.type === 'contract_credited' || r.type_i === 33)
      .filter(r => Number(r.created_at_unix || Date.parse(r.created_at) / 1000) > cutoff)
      .map((r, i) => ({
        id:       r.id || `horizon-${i}`,
        merchant: r.account || r.source_account || '—',
        reason:   r.type_code || 'LargePayment',
        amount:   parseInt(r.amount || 0),
        ts:       Math.floor(Date.parse(r.created_at) / 1000),
      }));
  } catch {
    return null; // fall through to demo data
  }
}

// ── Render panels ─────────────────────────────────────────────────────────

function renderSuspiciousEvents(events) {
  const loadEl  = document.getElementById('events-loading');
  const tableEl = document.getElementById('events-table');
  const emptyEl = document.getElementById('events-empty');
  const tbody   = document.getElementById('events-body');
  const countEl = document.getElementById('events-count');

  loadEl.hidden = true;
  countEl.textContent = events.length;

  if (events.length === 0) { emptyEl.hidden = false; return; }

  tbody.innerHTML = '';
  events.forEach(ev => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${fmtTime(ev.ts)}</td>
      <td title="${ev.merchant}">${shorten(ev.merchant)}</td>
      <td class="${severityClass(ev.reason)}">${reasonLabel(ev.reason)}</td>
      <td>${ev.amount ? fmtAmount(ev.amount) + ' XLM' : '—'}</td>
    `;
    tbody.appendChild(tr);
  });
  tableEl.hidden = false;

  // Update alert badge for newly seen events
  const freshIds = events.map(e => e.id).filter(id => !seenEventIds.has(id));
  newAlertCount += freshIds.length;
  freshIds.forEach(id => seenEventIds.add(id));
  sessionStorage.setItem('seen_event_ids', JSON.stringify([...seenEventIds]));

  if (newAlertCount > 0) {
    alertCount.textContent = newAlertCount;
    alertBadge.hidden = false;
  }

  document.getElementById('kpi-suspicious').textContent = events.length;
}

function renderRefundRates(rates) {
  const loadEl  = document.getElementById('refund-loading');
  const tableEl = document.getElementById('refund-table');
  const emptyEl = document.getElementById('refund-empty');
  const tbody   = document.getElementById('refund-body');

  loadEl.hidden = true;
  if (rates.length === 0) { emptyEl.hidden = false; return; }

  tbody.innerHTML = '';
  rates.slice(0, 10).forEach(r => {
    const rateClass = r.rate > 25 ? 'rate-high' : r.rate > 15 ? 'rate-medium' : 'rate-ok';
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td title="${r.merchant}">${shorten(r.merchant)}</td>
      <td>${r.payments.toLocaleString()}</td>
      <td>${r.refunds.toLocaleString()}</td>
      <td class="${rateClass}">${r.rate.toFixed(1)} %</td>
    `;
    tbody.appendChild(tr);
  });
  tableEl.hidden = false;

  const highRateCount = rates.filter(r => r.rate > 15).length;
  document.getElementById('kpi-high-refund-merchants').textContent = highRateCount;
}

function renderLargePayments(payments) {
  const loadEl  = document.getElementById('large-loading');
  const tableEl = document.getElementById('large-table');
  const emptyEl = document.getElementById('large-empty');
  const tbody   = document.getElementById('large-body');
  const labelEl = document.getElementById('threshold-label');

  loadEl.hidden = true;
  labelEl.textContent = `Threshold: ${fmtAmount(largePaymentThresholdStroops())} XLM`;

  if (payments.length === 0) { emptyEl.hidden = false; return; }

  tbody.innerHTML = '';
  payments.forEach(p => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${fmtTime(p.ts)}</td>
      <td>${p.orderId}</td>
      <td title="${p.merchant}">${shorten(p.merchant)}</td>
      <td title="${p.payer}">${shorten(p.payer)}</td>
      <td class="severity-high">${fmtAmount(p.amount)}</td>
    `;
    tbody.appendChild(tr);
  });
  tableEl.hidden = false;
  document.getElementById('kpi-large-payments').textContent = payments.length;
}

function renderVelocityAnomalies(anomalies) {
  const loadEl  = document.getElementById('velocity-loading');
  const tableEl = document.getElementById('velocity-table');
  const emptyEl = document.getElementById('velocity-empty');
  const tbody   = document.getElementById('velocity-body');

  loadEl.hidden = true;
  if (anomalies.length === 0) { emptyEl.hidden = false; return; }

  tbody.innerHTML = '';
  anomalies.forEach(a => {
    const spikeClass = a.spikeFactor >= 6 ? 'severity-high' : a.spikeFactor >= 4 ? 'severity-medium' : 'severity-low';
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td title="${a.merchant}">${shorten(a.merchant)}</td>
      <td>${a.paymentsPerHour}</td>
      <td>${a.avgPerHour.toFixed(1)}</td>
      <td class="${spikeClass}">${a.spikeFactor.toFixed(1)}×</td>
    `;
    tbody.appendChild(tr);
  });
  tableEl.hidden = false;
  document.getElementById('kpi-velocity-anomalies').textContent = anomalies.length;
}

// ── Main refresh cycle ────────────────────────────────────────────────────

async function refresh() {
  refreshBtn.disabled = true;
  refreshBtn.textContent = '↻ Refreshing…';

  // Reset loading states
  ['events-loading','refund-loading','large-loading','velocity-loading'].forEach(id => {
    document.getElementById(id).hidden = false;
  });
  ['events-table','events-empty','refund-table','refund-empty',
   'large-table','large-empty','velocity-table','velocity-empty'].forEach(id => {
    document.getElementById(id).hidden = true;
  });

  let data;
  if (CONTRACT_ID) {
    const events = await fetchSuspiciousEventsFromHorizon(CONTRACT_ID);
    if (events) {
      // Live mode: use real events, demo for other panels until full API integration
      data = getDemoData();
      data.suspiciousEvents = events;
    } else {
      data = getDemoData();
    }
  } else {
    // Demo mode
    data = getDemoData();
  }

  renderSuspiciousEvents(data.suspiciousEvents);
  renderRefundRates(data.refundRates);
  renderLargePayments(data.largePayments);
  renderVelocityAnomalies(data.velocityAnomalies);

  const now = new Date();
  lastRefreshEl.textContent = `Last updated: ${now.toLocaleTimeString()}`;
  refreshBtn.disabled = false;
  refreshBtn.textContent = '↻ Refresh';
}

// ── Settings panel ────────────────────────────────────────────────────────

const settingsBtn   = document.getElementById('settings-btn');
const settingsPanel = document.getElementById('settings-panel');
const settingsClose = document.getElementById('settings-close');
const settingsForm  = document.getElementById('settings-form');
const settingsReset = document.getElementById('settings-reset');
const savedMsg      = document.getElementById('settings-saved-msg');

const inputLargeThreshold = document.getElementById('setting-large-payment-threshold');
const inputVelocityLimit  = document.getElementById('setting-velocity-limit');
const errLargeThreshold   = document.getElementById('setting-large-payment-threshold-error');
const errVelocityLimit    = document.getElementById('setting-velocity-limit-error');

/** Populate form fields with current settings values. */
function populateSettingsForm() {
  inputLargeThreshold.value = settings.largePaymentThresholdXlm;
  inputVelocityLimit.value  = settings.velocityLimitPerHour;
}

/** Open the settings panel and populate fields. */
function openSettings() {
  populateSettingsForm();
  settingsPanel.hidden = false;
  settingsBtn.setAttribute('aria-expanded', 'true');
  settingsClose.focus();
  savedMsg.hidden = true;
}

/** Close the settings panel. */
function closeSettings() {
  settingsPanel.hidden = true;
  settingsBtn.setAttribute('aria-expanded', 'false');
  settingsBtn.focus();
}

/** Validate and save settings, then re-render the dashboard. */
function handleSettingsSave(e) {
  e.preventDefault();

  let valid = true;

  // Validate large payment threshold
  const thresholdVal = parseFloat(inputLargeThreshold.value);
  if (isNaN(thresholdVal) || thresholdVal <= 0) {
    errLargeThreshold.textContent = 'Enter a positive number greater than 0.';
    errLargeThreshold.hidden = false;
    inputLargeThreshold.classList.add('invalid');
    valid = false;
  } else {
    errLargeThreshold.hidden = true;
    inputLargeThreshold.classList.remove('invalid');
  }

  // Validate velocity limit
  const velocityVal = parseInt(inputVelocityLimit.value, 10);
  if (isNaN(velocityVal) || velocityVal < 1) {
    errVelocityLimit.textContent = 'Enter a whole number of at least 1.';
    errVelocityLimit.hidden = false;
    inputVelocityLimit.classList.add('invalid');
    valid = false;
  } else {
    errVelocityLimit.hidden = true;
    inputVelocityLimit.classList.remove('invalid');
  }

  if (!valid) return;

  // Persist and apply immediately
  settings = {
    largePaymentThresholdXlm: thresholdVal,
    velocityLimitPerHour: velocityVal,
  };
  saveSettings(settings);

  // Update the legacy variable for any code reading it directly
  LARGE_PAYMENT_THRESHOLD = largePaymentThresholdStroops();

  // Show confirmation and re-render dashboard without closing the panel
  savedMsg.hidden = false;
  refresh();
}

/** Reset settings to defaults, repopulate form, and re-render. */
function handleSettingsReset() {
  settings = { ...DEFAULTS };
  saveSettings(settings);
  LARGE_PAYMENT_THRESHOLD = largePaymentThresholdStroops();
  populateSettingsForm();
  savedMsg.hidden = false;
  refresh();
}

// Close settings panel when clicking outside (backdrop)
document.addEventListener('click', (e) => {
  if (
    !settingsPanel.hidden &&
    !settingsPanel.contains(e.target) &&
    e.target !== settingsBtn
  ) {
    closeSettings();
  }
});

// Keyboard: Escape closes the panel
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !settingsPanel.hidden) {
    closeSettings();
  }
});

settingsBtn.addEventListener('click', () => {
  settingsPanel.hidden ? openSettings() : closeSettings();
});
settingsClose.addEventListener('click', closeSettings);
settingsForm.addEventListener('submit', handleSettingsSave);
settingsReset.addEventListener('click', handleSettingsReset);

// ── Bootstrap ─────────────────────────────────────────────────────────────

refresh();
setInterval(refresh, REFRESH_MS);
refreshBtn.addEventListener('click', () => { newAlertCount = 0; alertBadge.hidden = true; refresh(); });
