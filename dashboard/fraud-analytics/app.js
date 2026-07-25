/* Fraud Analytics Dashboard — app.js
 *
 * Features:
 *  - SSE streaming from Horizon for suspicious_activity events (issue #651)
 *  - Polling fallback when SSE is blocked (issue #651)
 *  - Live / Reconnecting status indicator (issue #651)
 *  - Dark mode synced with localStorage key 'lumenflow_theme' (issue #652)
 */

// ── Configuration ────────────────────────────────────────────────────────────

const HORIZON_BASE  = window.HORIZON_BASE || 'https://horizon-testnet.stellar.org';
const CONTRACT_ID   = window.CONTRACT_ID  || null;
const SSE_RECONNECT_DELAY_MS = 10_000;
const POLL_INTERVAL_MS       = 15_000;
const MAX_EVENTS             = 200;

// ── State ────────────────────────────────────────────────────────────────────

const state = {
  events:     [],      // array of parsed event objects
  metrics: {
    total:     0,
    high:      0,
    medium:    0,
    addresses: new Set(),
  },
  sse:       null,     // active EventSource (or null)
  pollTimer: null,     // fallback poll interval handle
  sseFailed: false,    // true once SSE has failed and we fell back to polling
};

// ── DOM refs ─────────────────────────────────────────────────────────────────

const streamStatusEl  = document.getElementById('streamStatus');
const eventsTableEl   = document.getElementById('eventsTable');
const eventsBodyEl    = document.getElementById('eventsBody');
const emptyStateEl    = document.getElementById('emptyState');
const metricTotalEl   = document.getElementById('metricTotal');
const metricHighEl    = document.getElementById('metricHigh');
const metricMediumEl  = document.getElementById('metricMedium');
const metricAddrsEl   = document.getElementById('metricAddresses');

// ── Rendering ────────────────────────────────────────────────────────────────

function updateMetricsDisplay() {
  metricTotalEl.textContent  = state.metrics.total;
  metricHighEl.textContent   = state.metrics.high;
  metricMediumEl.textContent = state.metrics.medium;
  metricAddrsEl.textContent  = state.metrics.addresses.size;
}

function severityFromReason(reason) {
  if (!reason) return 'medium';
  const r = String(reason).toLowerCase();
  if (r.includes('large') || r.includes('auth'))   return 'high';
  if (r.includes('rapid') || r.includes('refund')) return 'medium';
  return 'low';
}

function formatAddress(addr) {
  if (!addr || addr.length < 12) return addr || '—';
  return addr.slice(0, 6) + '…' + addr.slice(-4);
}

function formatTime(isoString) {
  try {
    return new Date(isoString).toLocaleTimeString();
  } catch {
    return isoString || '—';
  }
}

function formatAmount(amount) {
  if (amount == null) return '—';
  const n = Number(amount);
  return isNaN(n) ? String(amount) : (n / 1e7).toFixed(7) + ' XLM';
}

function addEvent(evt) {
  state.events.unshift(evt); // newest first
  if (state.events.length > MAX_EVENTS) state.events.pop();

  // Update metrics
  state.metrics.total++;
  const sev = severityFromReason(evt.reason);
  if (sev === 'high')   state.metrics.high++;
  if (sev === 'medium') state.metrics.medium++;
  if (evt.address) state.metrics.addresses.add(evt.address);

  updateMetricsDisplay();
  renderEventsTable();
}

function renderEventsTable() {
  if (!state.events.length) {
    emptyStateEl.style.display = 'block';
    eventsTableEl.style.display = 'none';
    return;
  }
  emptyStateEl.style.display = 'none';
  eventsTableEl.style.display = 'table';

  eventsBodyEl.innerHTML = '';
  state.events.forEach(evt => {
    const sev = severityFromReason(evt.reason);
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${formatTime(evt.time)}</td>
      <td title="${evt.address || ''}">${formatAddress(evt.address)}</td>
      <td>${evt.reason || '—'}</td>
      <td>${formatAmount(evt.amount)}</td>
      <td><span class="badge badge-${sev}">${sev}</span></td>
    `;
    eventsBodyEl.appendChild(tr);
  });
}

// ── Status indicator ─────────────────────────────────────────────────────────

function setStreamStatus(status) {
  // status: 'live' | 'reconnecting' | 'polling'
  streamStatusEl.className = 'status-indicator';
  if (status === 'live') {
    streamStatusEl.classList.add('live');
    streamStatusEl.textContent = 'Live';
  } else if (status === 'polling') {
    streamStatusEl.classList.add('reconnecting');
    streamStatusEl.textContent = 'Polling';
  } else {
    streamStatusEl.classList.add('reconnecting');
    streamStatusEl.textContent = 'Reconnecting…';
  }
}

// ── SSE streaming ─────────────────────────────────────────────────────────────

/**
 * Build a Horizon SSE URL for the contract's event stream.
 * In production this would be the real Horizon /events endpoint.
 */
function buildSseUrl() {
  if (CONTRACT_ID) {
    return `${HORIZON_BASE}/events?contract_id=${CONTRACT_ID}&topic=lumenflow%2Fsuspicious_activity&cursor=now`;
  }
  // Fallback: stream all events for demo
  return `${HORIZON_BASE}/events?cursor=now`;
}

function parseHorizonEvent(raw) {
  // Horizon SSE data is JSON.  Attempt to extract useful fields.
  try {
    const data = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return {
      time:    data.created_at || new Date().toISOString(),
      address: data.payer || data.address || (data.value && data.value[0]) || null,
      reason:  data.topic?.[1] || data.reason || 'suspicious_activity',
      amount:  data.amount || null,
      raw:     data,
    };
  } catch {
    return {
      time:   new Date().toISOString(),
      reason: 'suspicious_activity',
      raw:    raw,
    };
  }
}

let _reconnectTimer = null;

function openSse() {
  if (state.sse) {
    state.sse.close();
    state.sse = null;
  }
  clearTimeout(_reconnectTimer);

  const url = buildSseUrl();

  let es;
  try {
    es = new EventSource(url);
  } catch (err) {
    // EventSource constructor itself threw (extremely unlikely in modern browsers)
    console.warn('[fraud-analytics] EventSource() threw:', err);
    fallbackToPolling();
    return;
  }

  state.sse = es;
  setStreamStatus('reconnecting');

  es.addEventListener('open', () => {
    setStreamStatus('live');
    state.sseFailed = false;
  });

  // Horizon emits named "events" events for contract events
  es.addEventListener('events', (e) => {
    try {
      const parsed = parseHorizonEvent(e.data);
      // Only surface suspicious_activity events
      if (!parsed.reason || parsed.reason.includes('suspicious')) {
        addEvent(parsed);
      }
    } catch (err) {
      console.warn('[fraud-analytics] Event parse error:', err);
    }
  });

  // Generic message fallback
  es.addEventListener('message', (e) => {
    try {
      const parsed = parseHorizonEvent(e.data);
      addEvent(parsed);
    } catch (err) {
      console.warn('[fraud-analytics] Message parse error:', err);
    }
  });

  es.addEventListener('error', () => {
    es.close();
    state.sse = null;
    setStreamStatus('reconnecting');

    if (!state.sseFailed) {
      // First failure — schedule reconnect after 10s (per spec)
      _reconnectTimer = setTimeout(() => {
        openSse();
      }, SSE_RECONNECT_DELAY_MS);
    } else {
      // SSE has failed twice — switch to polling fallback
      fallbackToPolling();
    }
    state.sseFailed = true;
  });
}

// ── Polling fallback ─────────────────────────────────────────────────────────

async function pollOnce() {
  try {
    // Build a REST query for recent suspicious_activity events
    const url = CONTRACT_ID
      ? `${HORIZON_BASE}/events?contract_id=${CONTRACT_ID}&topic=lumenflow%2Fsuspicious_activity&order=desc&limit=20`
      : null;

    if (!url) {
      // No contract ID — inject demo data in demo mode
      injectDemoEvent();
      return;
    }

    const resp = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

    const json = await resp.json();
    const records = json._embedded?.records || json.records || [];
    records.forEach(r => addEvent(parseHorizonEvent(r)));
  } catch (err) {
    console.warn('[fraud-analytics] Poll error:', err);
  }
}

function fallbackToPolling() {
  if (state.pollTimer) return; // already polling
  setStreamStatus('polling');
  pollOnce();
  state.pollTimer = setInterval(pollOnce, POLL_INTERVAL_MS);
}

// ── Demo mode (no contract ID) ────────────────────────────────────────────────

const _DEMO_REASONS = [
  'LargePayment',
  'RapidRefunds',
  'ManyAuthFailures',
];

let _demoCounter = 0;

function injectDemoEvent() {
  const reason = _DEMO_REASONS[_demoCounter % _DEMO_REASONS.length];
  _demoCounter++;
  addEvent({
    time:    new Date().toISOString(),
    address: `GDEMO${String(_demoCounter).padStart(5, '0')}AAAAAAAAAAAAAAAAAAAAAAAAAAAA`,
    reason,
    amount:  Math.floor(Math.random() * 1_000_000_000),
  });
}

// ── Dark mode ─────────────────────────────────────────────────────────────────

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem('lumenflow_theme', theme);
  const btn = document.getElementById('themeToggle');
  if (btn) btn.textContent = theme === 'dark' ? '☀️ Light' : '🌙 Dark';
}

document.getElementById('themeToggle').addEventListener('click', () => {
  const current = document.documentElement.getAttribute('data-theme');
  applyTheme(current === 'dark' ? 'light' : 'dark');
});

// Sync label with initial theme applied by the inline script
(function syncToggleLabel() {
  const current = document.documentElement.getAttribute('data-theme') || 'light';
  const btn = document.getElementById('themeToggle');
  if (btn) btn.textContent = current === 'dark' ? '☀️ Light' : '🌙 Dark';
})();

// ── Lifecycle ─────────────────────────────────────────────────────────────────

function init() {
  // Attempt SSE first; if EventSource is not available fall back immediately
  if (typeof EventSource === 'undefined') {
    console.info('[fraud-analytics] EventSource not supported, using polling fallback.');
    fallbackToPolling();
  } else {
    openSse();
  }

  // Demo mode: inject an initial event set so the dashboard isn't blank
  if (!CONTRACT_ID) {
    for (let i = 0; i < 5; i++) injectDemoEvent();
  }
}

window.addEventListener('pagehide', () => {
  if (state.sse) state.sse.close();
  clearInterval(state.pollTimer);
  clearTimeout(_reconnectTimer);
});

init();
