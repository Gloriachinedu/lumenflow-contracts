/**
 * Fraud Analytics Dashboard — app.js
 *
 * Surfaces large payments and suspicious refund patterns as product analytics.
 * Supports demo mode (mock data) and live mode (contract events via Horizon SSE).
 *
 * Key constants:
 *   SUSPICIOUS_THRESHOLD   — large-payment flag in stroops (default 100 000)
 *   REFUND_RATE_THRESHOLD  — refund-rate alert as a fraction (default 0.30 = 30 %)
 */

// ---------------------------------------------------------------------------
// Configurable thresholds (mutated when the operator saves new values)
// ---------------------------------------------------------------------------
let SUSPICIOUS_THRESHOLD = 100_000;   // stroops
let REFUND_RATE_THRESHOLD = 0.30;     // 30 %

// ---------------------------------------------------------------------------
// Demo / live mode detection
// ---------------------------------------------------------------------------
const CONTRACT_ID = window.LUMENFLOW_CONTRACT_ID ?? null;
const NETWORK     = window.LUMENFLOW_NETWORK     ?? null;
const DEMO_MODE   = !(CONTRACT_ID && NETWORK);

// ---------------------------------------------------------------------------
// Demo data — 6 mock payments; 2 suspiciously large, 1 with a high refund rate
// ---------------------------------------------------------------------------
const DEMO_PAYMENTS = [
  {
    order_id:     'ORDER_001',
    payer:        'GBPKE...A7XQ',
    merchant:     'GCMER...B2YR',
    amount:       5_000,
    token:        'USDC',
    paid_at:      Date.now() - 3_600_000 * 5,   // 5 h ago
    refunded:     0,
  },
  {
    order_id:     'ORDER_002',
    payer:        'GBPKE...A7XQ',
    merchant:     'GCMER...B2YR',
    amount:       250_000,   // ⚠ suspicious — above default threshold
    token:        'USDC',
    paid_at:      Date.now() - 3_600_000 * 3,
    refunded:     0,
  },
  {
    order_id:     'ORDER_003',
    payer:        'GDIFF...C3ZP',
    merchant:     'GCMER...B2YR',
    amount:       12_000,
    token:        'XLM',
    paid_at:      Date.now() - 3_600_000 * 24,
    refunded:     4_200,     // 35 % refund rate — above default 30 %
  },
  {
    order_id:     'ORDER_004',
    payer:        'GTEST...D4WV',
    merchant:     'GCMER...B2YR',
    amount:       500_000,   // ⚠ suspicious — very large
    token:        'USDC',
    paid_at:      Date.now() - 3_600_000 * 1,
    refunded:     0,
  },
  {
    order_id:     'ORDER_005',
    payer:        'GTEST...D4WV',
    merchant:     'GCMER...B2YR',
    amount:       8_000,
    token:        'XLM',
    paid_at:      Date.now() - 3_600_000 * 48,
    refunded:     0,
  },
  {
    order_id:     'ORDER_006',
    payer:        'GALPH...E5KM',
    merchant:     'GCMER...B2YR',
    amount:       3_500,
    token:        'USDC',
    paid_at:      Date.now() - 3_600_000 * 12,
    refunded:     1_050,
  },
];

// Demo suspicious-activity contract events (mimic lumenflow/suspicious_activity)
const DEMO_EVENTS = [
  {
    id:        'evt-1',
    timestamp: Date.now() - 3_600_000 * 1,
    order_id:  'ORDER_004',
    type:      'LargePayment',
    detail:    'Amount 500 000 stroops exceeds threshold',
  },
  {
    id:        'evt-2',
    timestamp: Date.now() - 3_600_000 * 3,
    order_id:  'ORDER_002',
    type:      'LargePayment',
    detail:    'Amount 250 000 stroops exceeds threshold',
  },
  {
    id:        'evt-3',
    timestamp: Date.now() - 3_600_000 * 24,
    order_id:  'ORDER_003',
    type:      'HighRefundRate',
    detail:    'Refund rate 35 % exceeds 30 % alert threshold',
  },
];

// Internal alert store (populated by generateAlerts)
let activeAlerts = [];

// ---------------------------------------------------------------------------
// Core analysis functions
// ---------------------------------------------------------------------------

/**
 * analyzePayment — classify a single payment by risk level.
 *
 * @param {object} payment
 * @returns {'high'|'medium'|'low'}
 */
export function analyzePayment(payment) {
  const { amount } = payment;
  if (amount >= SUSPICIOUS_THRESHOLD * 5) return 'high';
  if (amount >= SUSPICIOUS_THRESHOLD)      return 'medium';
  return 'low';
}

/**
 * generateAlerts — filter payments that meet alert criteria and produce
 * structured alert objects.
 *
 * Criteria:
 *   • amount >= SUSPICIOUS_THRESHOLD → large-payment alert
 *   • refunded / amount >= REFUND_RATE_THRESHOLD → high-refund-rate alert
 *
 * @param {object[]} payments
 * @returns {object[]} alert list
 */
export function generateAlerts(payments) {
  const alerts = [];

  for (const p of payments) {
    const riskLevel = analyzePayment(p);

    // Large-payment alert
    if (p.amount >= SUSPICIOUS_THRESHOLD) {
      alerts.push({
        id:        `alert-large-${p.order_id}`,
        order_id:  p.order_id,
        type:      'Large Payment',
        amount:    p.amount,
        token:     p.token,
        timestamp: p.paid_at,
        risk:      riskLevel,
        status:    'open',
      });
    }

    // High refund-rate alert (only when there are refunds to consider)
    if (p.amount > 0 && p.refunded > 0) {
      const rate = p.refunded / p.amount;
      if (rate >= REFUND_RATE_THRESHOLD) {
        alerts.push({
          id:        `alert-refund-${p.order_id}`,
          order_id:  p.order_id,
          type:      'High Refund Rate',
          amount:    p.amount,
          token:     p.token,
          timestamp: p.paid_at,
          risk:      'medium',
          status:    'open',
          detail:    `${(rate * 100).toFixed(1)} % refunded`,
        });
      }
    }
  }

  // Sort newest first
  alerts.sort((a, b) => b.timestamp - a.timestamp);
  return alerts;
}

// ---------------------------------------------------------------------------
// Render functions
// ---------------------------------------------------------------------------

/**
 * renderAlerts — populate the alerts table from the current activeAlerts list.
 *
 * @param {object[]} alerts
 */
export function renderAlerts(alerts) {
  const tbody      = document.getElementById('alertsTableBody');
  const emptyState = document.getElementById('alertsEmpty');
  const table      = document.getElementById('alertsTable');

  tbody.innerHTML = '';

  const visible = alerts.filter(a => a.status !== 'dismissed');

  if (!visible.length) {
    emptyState.style.display = 'block';
    table.style.display      = 'none';
    return;
  }

  emptyState.style.display = 'none';
  table.style.display      = 'table';

  for (const alert of visible) {
    const tr = document.createElement('tr');
    tr.dataset.alertId = alert.id;

    const riskClass = `risk-${alert.risk}`;
    const riskLabel = alert.risk.charAt(0).toUpperCase() + alert.risk.slice(1);
    const timeStr   = new Date(alert.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const dateStr   = new Date(alert.timestamp).toLocaleDateString();
    const statusLabel = alert.status === 'reviewing'
      ? '<span class="reviewing-badge">Under Review</span>'
      : '';

    tr.innerHTML = `
      <td data-label="Time">
        <time datetime="${new Date(alert.timestamp).toISOString()}">${dateStr} ${timeStr}</time>
      </td>
      <td data-label="Order ID"><code>${escapeHtml(alert.order_id)}</code></td>
      <td data-label="Type">
        ${escapeHtml(alert.type)}
        ${alert.detail ? `<br><small class="detail-text">${escapeHtml(alert.detail)}</small>` : ''}
        ${statusLabel}
      </td>
      <td data-label="Amount (stroops)">${alert.amount.toLocaleString()} <span class="token-label">${escapeHtml(alert.token)}</span></td>
      <td data-label="Risk Level">
        <span class="risk-badge ${riskClass}" aria-label="Risk level: ${riskLabel}">${riskLabel}</span>
      </td>
      <td data-label="Action" class="action-cell">
        <button class="btn-review btn-sm" data-id="${escapeHtml(alert.id)}" aria-label="Review alert for ${escapeHtml(alert.order_id)}">Review</button>
        <button class="btn-dismiss-alert btn-sm" data-id="${escapeHtml(alert.id)}" aria-label="Dismiss alert for ${escapeHtml(alert.order_id)}">Dismiss</button>
      </td>
    `;

    tbody.appendChild(tr);
  }

  // Attach event listeners
  tbody.querySelectorAll('.btn-review').forEach(btn =>
    btn.addEventListener('click', () => reviewAlert(btn.dataset.id))
  );
  tbody.querySelectorAll('.btn-dismiss-alert').forEach(btn =>
    btn.addEventListener('click', () => dismissAlert(btn.dataset.id))
  );
}

/**
 * renderMetrics — update the 4 summary metric cards.
 *
 * @param {object[]} alerts   — current alert list
 * @param {object[]} payments — full payment list used for refund rate
 */
export function renderMetrics(alerts, payments) {
  const flagged   = alerts.filter(a => a.status !== 'dismissed').length;
  const highValue = alerts.filter(a => a.risk === 'high' && a.status !== 'dismissed').length;

  // Aggregate refund rate across all payments
  const totalAmount   = payments.reduce((sum, p) => sum + p.amount, 0);
  const totalRefunded = payments.reduce((sum, p) => sum + (p.refunded ?? 0), 0);
  const refundRate    = totalAmount > 0 ? (totalRefunded / totalAmount) * 100 : 0;

  const now = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  document.getElementById('metricFlagged').textContent   = flagged;
  document.getElementById('metricHighValue').textContent = highValue;
  document.getElementById('metricRefundRate').textContent = `${refundRate.toFixed(1)}%`;
  document.getElementById('metricLastScan').textContent  = now;
  document.getElementById('lastScanBadge').textContent   = `Last scan: ${now}`;
}

/**
 * renderEventLog — populate the suspicious-activity event log section.
 *
 * @param {object[]} events
 */
function renderEventLog(events) {
  const log        = document.getElementById('eventLog');
  const emptyState = document.getElementById('eventLogEmpty');

  log.innerHTML = '';

  if (!events.length) {
    emptyState.style.display = 'block';
    log.style.display        = 'none';
    return;
  }

  emptyState.style.display = 'none';
  log.style.display        = 'block';

  for (const evt of events) {
    const li       = document.createElement('li');
    li.className   = 'event-log-item';
    const timeStr  = new Date(evt.timestamp).toLocaleString();
    li.innerHTML = `
      <span class="event-time">${timeStr}</span>
      <span class="event-type-badge">${escapeHtml(evt.type)}</span>
      <code class="event-order">${escapeHtml(evt.order_id)}</code>
      <span class="event-detail">${escapeHtml(evt.detail)}</span>
    `;
    log.appendChild(li);
  }
}

// ---------------------------------------------------------------------------
// Alert action handlers
// ---------------------------------------------------------------------------

/**
 * dismissAlert — remove an alert from the visible list and re-render.
 *
 * @param {string} id
 */
export function dismissAlert(id) {
  const alert = activeAlerts.find(a => a.id === id);
  if (!alert) return;
  alert.status = 'dismissed';
  console.info(`[LumenFlow Fraud] Alert dismissed: ${id}`);
  renderAlerts(activeAlerts);
  renderMetrics(activeAlerts, currentPayments());
}

/**
 * reviewAlert — mark an alert as under review and log to console.
 *
 * @param {string} id
 */
export function reviewAlert(id) {
  const alert = activeAlerts.find(a => a.id === id);
  if (!alert) return;
  alert.status = 'reviewing';
  console.info(`[LumenFlow Fraud] Alert under review: ${id}`, alert);
  renderAlerts(activeAlerts);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Returns the payments currently in scope (demo or live). */
function currentPayments() {
  return DEMO_MODE ? DEMO_PAYMENTS : [];   // live mode would return fetched payments
}

// ---------------------------------------------------------------------------
// Full analysis pass — called on load and when thresholds change
// ---------------------------------------------------------------------------
function runAnalysis(payments) {
  activeAlerts = generateAlerts(payments);
  renderAlerts(activeAlerts);
  renderMetrics(activeAlerts, payments);
}

// ---------------------------------------------------------------------------
// Threshold form handler
// ---------------------------------------------------------------------------
document.getElementById('thresholdForm').addEventListener('submit', (e) => {
  e.preventDefault();

  const thresholdInput  = document.getElementById('largePaymentThreshold');
  const refundRateInput = document.getElementById('refundRateAlert');
  const feedback        = document.getElementById('thresholdSaved');

  const newThreshold  = parseInt(thresholdInput.value, 10);
  const newRefundRate = parseFloat(refundRateInput.value);

  if (!Number.isFinite(newThreshold) || newThreshold < 1) {
    thresholdInput.setCustomValidity('Enter a positive integer for the threshold.');
    thresholdInput.reportValidity();
    return;
  }
  if (!Number.isFinite(newRefundRate) || newRefundRate < 0 || newRefundRate > 100) {
    refundRateInput.setCustomValidity('Enter a percentage between 0 and 100.');
    refundRateInput.reportValidity();
    return;
  }

  thresholdInput.setCustomValidity('');
  refundRateInput.setCustomValidity('');

  SUSPICIOUS_THRESHOLD  = newThreshold;
  REFUND_RATE_THRESHOLD = newRefundRate / 100;

  console.info(`[LumenFlow Fraud] Thresholds updated — large payment: ${SUSPICIOUS_THRESHOLD} stroops, refund rate: ${(REFUND_RATE_THRESHOLD * 100).toFixed(0)}%`);

  runAnalysis(currentPayments());

  feedback.textContent = '✓ Thresholds saved';
  setTimeout(() => { feedback.textContent = ''; }, 3000);
});

// ---------------------------------------------------------------------------
// Demo banner dismiss
// ---------------------------------------------------------------------------
document.getElementById('dismissBanner').addEventListener('click', () => {
  const banner = document.getElementById('demoBanner');
  banner.style.display = 'none';
});

// ---------------------------------------------------------------------------
// Initialisation
// ---------------------------------------------------------------------------
(function init() {
  if (DEMO_MODE) {
    // Demo mode: use mock data
    runAnalysis(DEMO_PAYMENTS);
    renderEventLog(DEMO_EVENTS);
  } else {
    // Live mode: fetch from contract / Horizon (not implemented in this release)
    console.info('[LumenFlow Fraud] Live mode — contract ID:', CONTRACT_ID, 'network:', NETWORK);
    runAnalysis([]);
    renderEventLog([]);
    document.getElementById('demoBanner').style.display = 'none';
    // TODO: subscribe to Horizon SSE for lumenflow/suspicious_activity events
  }
})();
