/**
 * Onboarding Analytics Dashboard — app.js
 *
 * Visualises the merchant registration funnel using analytics events collected
 * by frontend/onboarding-analytics.js. Shows step completion rates, drop-off
 * percentages, absolute counts, and wallet-connect outcomes.
 *
 * Data source: window.LUMENFLOW_ANALYTICS_ENDPOINT (JSON API) or demo data
 * when the endpoint is not configured.
 *
 * Resolves issue #1301.
 */

// ── Configuration ─────────────────────────────────────────────────────────
const ANALYTICS_ENDPOINT = window.LUMENFLOW_ANALYTICS_ENDPOINT || null;
const REFRESH_MS = 5 * 60 * 1000; // 5 minutes

// Funnel stages in logical order (mirrors FUNNEL_STAGES in onboarding-analytics.js)
const FUNNEL_STAGES = [
  { key: 'welcome',          label: 'Welcome' },
  { key: 'wallet',           label: 'Wallet Connect' },
  { key: 'business_details', label: 'Business Details' },
  { key: 'review',           label: 'Review' },
  { key: 'done',             label: 'Registration' },
  { key: 'first_payment',    label: 'First Payment' },
];

// Activation funnel: the three headline steps operators care about most.
// Each entry maps a funnel step to the analytics event(s) emitted by
// frontend/onboarding-analytics.js that mark its completion.
const ACTIVATION_FUNNEL = [
  { key: 'wallet',        label: 'Wallet Connect',  events: ['wallet_connected'] },
  { key: 'done',          label: 'Merchant Register', events: ['onboarding_completed', 'registration_completed'] },
  { key: 'first_payment', label: 'First Payment',   events: ['first_payment'] },
];

// Operator auth gate configuration.
const OPERATOR_AUTH_ENDPOINT = window.LUMENFLOW_OPERATOR_AUTH_ENDPOINT || null;
const OPERATOR_LOGIN_URL     = window.LUMENFLOW_OPERATOR_LOGIN_URL || '/login';

// ── State ──────────────────────────────────────────────────────────────────
let currentFrom = null;
let currentTo   = null;
let currentData = null; // last successfully fetched dataset (for CSV export)
let isAuthenticated = false;

// ── DOM refs ───────────────────────────────────────────────────────────────
const kpiStarted      = document.getElementById('kpi-started');
const kpiCompleted    = document.getElementById('kpi-completed');
const kpiRate         = document.getElementById('kpi-completion-rate');
const kpiDuration     = document.getElementById('kpi-avg-duration');
const lastRefreshEl   = document.getElementById('last-refresh');
const funnelDateLabel = document.getElementById('funnel-date-label');

const funnelLoading   = document.getElementById('funnel-loading');
const funnelChart     = document.getElementById('funnel-chart');
const funnelTableBody = document.getElementById('funnel-table-body');
const stepsLoading    = document.getElementById('steps-loading');
const stepsTable      = document.getElementById('steps-table');
const stepsBody       = document.getElementById('steps-body');
const stepsEmpty      = document.getElementById('steps-empty');
const walletLoading   = document.getElementById('wallet-loading');
const walletTable     = document.getElementById('wallet-table');
const walletBody      = document.getElementById('wallet-body');
const walletEmpty     = document.getElementById('wallet-empty');

const dateFrom  = document.getElementById('date-from');
const dateTo    = document.getElementById('date-to');
const applyBtn  = document.getElementById('apply-filter-btn');
const refreshBtn = document.getElementById('refresh-btn');
const exportBtn = document.getElementById('export-csv-btn');
const authGate  = document.getElementById('auth-gate');
const dashboardRoot = document.getElementById('dashboard-root');

// ── Helpers ────────────────────────────────────────────────────────────────

function pct(num, denom) {
  if (!denom) return 0;
  return Math.round((num / denom) * 1000) / 10;
}

function fmtPct(value) {
  return value.toFixed(1) + '%';
}

function fmtDuration(ms) {
  if (ms == null || isNaN(ms)) return '—';
  const secs = Math.round(ms / 1000);
  if (secs < 60)  return secs + 's';
  if (secs < 3600) return Math.round(secs / 60) + 'm';
  return (secs / 3600).toFixed(1) + 'h';
}

function pctClass(value) {
  if (value >= 70) return 'pct-high';
  if (value >= 40) return 'pct-medium';
  return 'pct-low';
}

function setVisible(el, visible) {
  if (visible) { el.removeAttribute('hidden'); } else { el.setAttribute('hidden', ''); }
}

// ── Demo data factory ──────────────────────────────────────────────────────

function buildDemoData(fromMs, toMs) {
  const base = { started: 420, completed: 267, avg_duration_ms: 195000 };

  // Slightly vary counts based on the selected date range length for realism.
  const days = toMs && fromMs ? Math.max(1, Math.round((toMs - fromMs) / 86400000)) : 7;
  const scale = days / 7;

  const started   = Math.round(base.started   * scale);
  const completed = Math.round(base.completed * scale);

  const stepCounts = FUNNEL_STAGES.map((_, i) => {
    // Each stage has fewer completions (drop-off cascade)
    const dropFactors = [1, 0.91, 0.83, 0.76, completed / started, (completed / started) * 0.62];
    return Math.round(started * dropFactors[i]);
  });

  const walletProviders = [
    { provider: 'freighter', attempts: Math.round(380 * scale), connected: Math.round(330 * scale), failed: Math.round(50 * scale) },
    { provider: 'albedo',    attempts: Math.round(95  * scale), connected: Math.round(80  * scale), failed: Math.round(15 * scale) },
    { provider: 'demo',      attempts: Math.round(60  * scale), connected: Math.round(60  * scale), failed: 0 },
  ];

  return { started, completed, avg_duration_ms: base.avg_duration_ms, stepCounts, walletProviders };
}

// ── Fetch analytics data ───────────────────────────────────────────────────

async function fetchData(fromMs, toMs) {
  if (!ANALYTICS_ENDPOINT) {
    // No endpoint configured — return demo data.
    return buildDemoData(fromMs, toMs);
  }

  const params = new URLSearchParams({ format: 'json' });
  if (fromMs) params.set('from', String(Math.floor(fromMs / 1000)));
  if (toMs)   params.set('to',   String(Math.floor(toMs   / 1000)));

  const res = await fetch(`${ANALYTICS_ENDPOINT}?${params}`, { credentials: 'include' });
  if (!res.ok) throw new Error(`Analytics API returned ${res.status}`);
  return res.json();
}

// ── Operator authentication gate ───────────────────────────────────────────

async function checkOperatorAuth() {
  if (!OPERATOR_AUTH_ENDPOINT) {
    // No auth endpoint configured (local/dev) — treat as authenticated.
    return true;
  }
  try {
    const res = await fetch(OPERATOR_AUTH_ENDPOINT, {
      credentials: 'include',
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) return false;
    const body = await res.json();
    return Boolean(body && (body.authenticated || body.operator));
  } catch (err) {
    console.error('[onboarding-analytics] auth check failed:', err);
    return false;
  }
}

function showAuthGate() {
  if (dashboardRoot) setVisible(dashboardRoot, false);
  if (authGate) {
    authGate.innerHTML = `
      <p>This dashboard is restricted to authenticated operators.</p>
      <p><a class="btn" href="${escHtml(OPERATOR_LOGIN_URL)}">Sign in</a></p>`;
    setVisible(authGate, true);
  }
}

// ── Activation funnel computation ──────────────────────────────────────────

/**
 * Build the wallet → register → first-payment activation funnel from the
 * step counts. Returns an array of { key, label, count, conversionPct,
 * dropoffPct } where conversionPct is the step-to-step conversion rate.
 */
function buildActivationFunnel(stepCounts) {
  const byKey = {};
  FUNNEL_STAGES.forEach((stage, i) => { byKey[stage.key] = stepCounts[i] || 0; });

  return ACTIVATION_FUNNEL.map((step, i) => {
    const count = byKey[step.key] || 0;
    const prev  = i === 0 ? count : (byKey[ACTIVATION_FUNNEL[i - 1].key] || 0);
    const conversionPct = i === 0 ? 100 : pct(count, prev);
    const dropoffPct    = i === 0 ? 0   : pct(prev - count, prev);
    return { key: step.key, label: step.label, count, conversionPct, dropoffPct };
  });
}

function renderActivationFunnel(stepCounts) {
  const el = document.getElementById('activation-funnel');
  if (!el) return;
  const funnel = buildActivationFunnel(stepCounts);
  el.innerHTML = '';

  funnel.forEach((step, i) => {
    const row = document.createElement('div');
    row.className = 'activation-step';
    const convLabel = i === 0
      ? '—'
      : `${fmtPct(step.conversionPct)} <span class="dropoff">(−${fmtPct(step.dropoffPct)})</span>`;
    row.innerHTML = `
      <span class="activation-step-label">${escHtml(step.label)}</span>
      <span class="activation-step-count">${step.count.toLocaleString()}</span>
      <span class="activation-step-conv">${convLabel}</span>`;
    el.appendChild(row);
  });
}

// ── CSV export ─────────────────────────────────────────────────────────────

function csvEscape(value) {
  const str = String(value == null ? '' : value);
  if (/[",\n]/.test(str)) return '"' + str.replace(/"/g, '""') + '"';
  return str;
}

function buildFunnelCsv(data) {
  const funnel = buildActivationFunnel(data.stepCounts || []);
  const lines = [['Step', 'Count', 'Conversion Rate (%)', 'Drop-off (%)'].join(',')];
  funnel.forEach((step, i) => {
    lines.push([
      csvEscape(step.label),
      step.count,
      i === 0 ? '' : step.conversionPct.toFixed(1),
      i === 0 ? '' : step.dropoffPct.toFixed(1),
    ].join(','));
  });
  return lines.join('\n');
}

function exportFunnelCsv() {
  if (!currentData) return;
  const csv = buildFunnelCsv(currentData);
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const stamp = new Date().toISOString().slice(0, 10);
  a.href = url;
  a.download = `onboarding-activation-funnel-${stamp}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ── Render funnel chart ────────────────────────────────────────────────────

function renderFunnel(stepCounts) {
  const maxCount = stepCounts[0] || 1;
  funnelChart.innerHTML = '';
  funnelTableBody.innerHTML = '';

  stepCounts.forEach((count, i) => {
    const stage = FUNNEL_STAGES[i];
    const widthPct = Math.max(2, pct(count, maxCount));
    const prevCount = i === 0 ? count : stepCounts[i - 1];
    const dropoff = i === 0 ? 0 : prevCount - count;
    const dropoffPct = i === 0 ? 0 : pct(dropoff, prevCount);

    // Visual funnel bar row
    const row = document.createElement('div');
    row.className = 'funnel-step';
    row.innerHTML = `
      <span class="funnel-step-label">${escHtml(stage.label)}</span>
      <div class="funnel-bar-wrap" role="presentation">
        <div class="funnel-bar" style="width:${widthPct}%" aria-hidden="true"></div>
      </div>
      <span class="funnel-count">${count.toLocaleString()}</span>
      <span class="funnel-dropoff${dropoff === 0 ? ' no-drop' : ''}">
        ${dropoff > 0 ? '−' + fmtPct(dropoffPct) : '—'}
      </span>`;
    funnelChart.appendChild(row);

    // Accessible table row (sr-only)
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${escHtml(stage.label)}</td>
      <td>${count.toLocaleString()}</td>
      <td>${dropoff > 0 ? fmtPct(dropoffPct) : '—'}</td>`;
    funnelTableBody.appendChild(tr);
  });

  setVisible(funnelLoading, false);
  setVisible(funnelChart, true);
}

// ── Render step breakdown table ────────────────────────────────────────────

function renderSteps(stepCounts) {
  const total = stepCounts[0] || 1;
  stepsBody.innerHTML = '';

  if (total === 0) {
    setVisible(stepsLoading, false);
    setVisible(stepsTable,   false);
    setVisible(stepsEmpty,   true);
    return;
  }

  stepCounts.forEach((count, i) => {
    const stage = FUNNEL_STAGES[i];
    const prevCount = i === 0 ? total : stepCounts[i - 1];
    const dropoff   = prevCount - count;
    const completionPct = pct(count, total);

    const tr = document.createElement('tr');
    const cls = pctClass(completionPct);
    tr.innerHTML = `
      <td>${i + 1}</td>
      <td>${escHtml(stage.label)}</td>
      <td>${count.toLocaleString()}</td>
      <td>${dropoff > 0 ? dropoff.toLocaleString() : '—'}</td>
      <td><span class="pct-pill ${cls}">${fmtPct(completionPct)}</span></td>`;
    stepsBody.appendChild(tr);
  });

  setVisible(stepsLoading, false);
  setVisible(stepsTable,   true);
  setVisible(stepsEmpty,   false);
}

// ── Render wallet outcomes table ───────────────────────────────────────────

function renderWallet(walletProviders) {
  walletBody.innerHTML = '';

  if (!walletProviders || walletProviders.length === 0) {
    setVisible(walletLoading, false);
    setVisible(walletTable,   false);
    setVisible(walletEmpty,   true);
    return;
  }

  walletProviders.forEach((wp) => {
    const successPct = pct(wp.connected, wp.attempts);
    const cls = pctClass(successPct);
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${escHtml(wp.provider)}</td>
      <td>${wp.attempts.toLocaleString()}</td>
      <td>${wp.connected.toLocaleString()}</td>
      <td>${wp.failed.toLocaleString()}</td>
      <td><span class="pct-pill ${cls}">${fmtPct(successPct)}</span></td>`;
    walletBody.appendChild(tr);
  });

  setVisible(walletLoading, false);
  setVisible(walletTable,   true);
  setVisible(walletEmpty,   false);
}

// ── Main render pipeline ───────────────────────────────────────────────────

async function render(fromMs, toMs) {
  // Reset loading states
  funnelLoading.textContent = 'Loading…';
  setVisible(funnelLoading, true);
  setVisible(funnelChart,   false);
  stepsLoading.textContent = 'Loading…';
  setVisible(stepsLoading, true);
  setVisible(stepsTable,   false);
  walletLoading.textContent = 'Loading…';
  setVisible(walletLoading, true);
  setVisible(walletTable,   false);

  try {
    const data = await fetchData(fromMs, toMs);

    // KPIs
    const completionRate = pct(data.completed, data.started);
    kpiStarted.textContent    = (data.started   || 0).toLocaleString();
    kpiCompleted.textContent  = (data.completed || 0).toLocaleString();
    kpiRate.textContent       = fmtPct(completionRate);
    kpiDuration.textContent   = fmtDuration(data.avg_duration_ms);

    // Date label
    if (fromMs && toMs) {
      const fmtDate = (ms) => new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
      funnelDateLabel.textContent = `${fmtDate(fromMs)} – ${fmtDate(toMs)}`;
    } else {
      funnelDateLabel.textContent = 'All time (demo data)';
    }

    currentData = data;

    renderFunnel(data.stepCounts);
    renderActivationFunnel(data.stepCounts);
    renderSteps(data.stepCounts);
    renderWallet(data.walletProviders);

    lastRefreshEl.textContent = 'Updated ' + new Date().toLocaleTimeString();
  } catch (err) {
    console.error('[onboarding-analytics] fetch error:', err);
    funnelLoading.textContent = 'Failed to load data.';
    stepsLoading.textContent  = 'Failed to load data.';
    walletLoading.textContent = 'Failed to load data.';
  }
}

// ── XSS guard ──────────────────────────────────────────────────────────────

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ── Date range helpers ─────────────────────────────────────────────────────

function getDateRange() {
  const from = dateFrom.value ? new Date(dateFrom.value).getTime() : null;
  const to   = dateTo.value   ? new Date(dateTo.value + 'T23:59:59').getTime() : null;
  return { from, to };
}

function setDefaultDateRange() {
  const now  = new Date();
  const past = new Date(now);
  past.setDate(now.getDate() - 6);
  dateFrom.value = past.toISOString().slice(0, 10);
  dateTo.value   = now.toISOString().slice(0, 10);
}

// ── Event wiring ───────────────────────────────────────────────────────────

applyBtn.addEventListener('click', () => {
  const { from, to } = getDateRange();
  currentFrom = from;
  currentTo   = to;
  render(from, to);
});

refreshBtn.addEventListener('click', () => {
  render(currentFrom, currentTo);
});

if (exportBtn) {
  exportBtn.addEventListener('click', exportFunnelCsv);
}

// ── Bootstrap ─────────────────────────────────────────────────────────────

async function bootstrap() {
  isAuthenticated = await checkOperatorAuth();
  if (!isAuthenticated) {
    showAuthGate();
    return;
  }

  if (authGate) setVisible(authGate, false);
  if (dashboardRoot) setVisible(dashboardRoot, true);

  setDefaultDateRange();
  const init = getDateRange();
  currentFrom = init.from;
  currentTo   = init.to;
  render(currentFrom, currentTo);

  // Auto-refresh
  setInterval(() => render(currentFrom, currentTo), REFRESH_MS);
}

bootstrap();
