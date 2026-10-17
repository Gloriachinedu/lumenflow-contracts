/* Minimal merchant refunds UI logic
   - Tabs for statuses
   - Approve / Reject with confirm modal
   - Execute (calls wallet if connected)
   - Wallet modal with Freighter / Albedo handlers
   - Polling for updates (mocked fetch)
*/

const state = {
  status: 'pending',
  refunds: [],
  wallet: null,
};

const accountEl = document.getElementById('account');
const tableBody = document.querySelector('#refundsTable tbody');
const emptyEl = document.getElementById('empty');

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
      const reject = document.createElement('button'); reject.textContent = 'Reject';
      approve.addEventListener('click', () => confirmAction('approve', r.id));
      reject.addEventListener('click', () => confirmAction('reject', r.id));
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
  const text = document.getElementById('confirmText');
  text.textContent = `Confirm ${action} for refund ${id}?`;
  openModal(modal);
  document.getElementById('confirmYes').onclick = async () => {
    closeModal(modal);
    if (action === 'approve') updateStatus(id, 'approved');
    if (action === 'reject') updateStatus(id, 'rejected');
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
  // Attempt to sign using wallet adapters (Freighter/Albedo)
  try {
    if (state.wallet.type === 'freighter' && window.freighter) {
      await window.freighter.signTransaction({memo: `refund:${id}`});
    } else if (state.wallet.type === 'albedo') {
      await window.albedo.sign({memo: `refund:${id}`});
    } else {
      console.warn('No wallet adapter present, simulate execute');
    }
    updateStatus(id, 'completed');
  } catch (e) {
    console.error(e);
    alert('Failed to execute refund');
  }
}

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

// Simple focus trap implementation
let lastFocused = null;
let trapListener = null;
function trapFocus(modal) {
  lastFocused = document.activeElement;
  const focusable = modal.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
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

// Wallet connect handlers
document.getElementById('connectWallet').addEventListener('click', () => openModal(document.getElementById('walletModal')));
document.getElementById('walletClose').addEventListener('click', () => closeModal(document.getElementById('walletModal')));
document.getElementById('freighter').addEventListener('click', async () => {
  closeModal(document.getElementById('walletModal'));
  // Attempt Freighter connection
  if (window.freighter) {
    try {
      const resp = await window.freighter.getConnectedAccount();
      state.wallet = {type: 'freighter', account: resp.publicKey};
      localStorage.setItem('wallet', JSON.stringify(state.wallet));
      accountEl.textContent = shorten(resp.publicKey);
    } catch (e) { alert('Freighter not available'); }
  } else { alert('Freighter not installed'); }
});
document.getElementById('albedo').addEventListener('click', async () => {
  closeModal(document.getElementById('walletModal'));
  if (window.albedo) {
    try {
      const resp = await window.albedo.publicKey();
      state.wallet = {type: 'albedo', account: resp};
      localStorage.setItem('wallet', JSON.stringify(state.wallet));
      accountEl.textContent = shorten(resp);
    } catch (e) { alert('Albedo connect failed'); }
  } else { alert('Albedo not available'); }
});

function shorten(a) { return a ? a.slice(0,6)+'…'+a.slice(-4) : '—'; }

// Tabs
document.querySelectorAll('.tabs .tab').forEach(btn => btn.addEventListener('click', () => setStatus(btn.dataset.status)));

// Mock fetch — in real app call backend API or use streaming (EventSource)
async function fetchRefunds() {
  // placeholder: generate some items
  const now = Date.now();
  state.refunds = [
    {id: 'r1', customer: 'Alice', amount: '10 XLM', status: 'pending'},
    {id: 'r2', customer: 'Bob', amount: '5 XLM', status: 'approved'},
  ];
  render();
}

// Poll every 10s
fetchRefunds();
setInterval(fetchRefunds, 10000);

// Restore wallet state
const saved = localStorage.getItem('wallet');
if (saved) {
  try { state.wallet = JSON.parse(saved); accountEl.textContent = shorten(state.wallet.account); } catch(e){}
}

// ─────────────────────────────────────────────────────────────────────────────
// Payment Volume Trend Chart  (Issue #1248)
// Uses the Canvas 2D API — no external charting library.
// ─────────────────────────────────────────────────────────────────────────────

(function initVolumeChart() {
  // ── 1. Mock / live data source ──────────────────────────────────────────────
  //
  // In live mode replace getMerchantStats() with a real Soroban RPC call to
  // `get_merchant_stats`.  The returned object is expected to have a
  // `daily_volumes` array of { timestamp_secs: number, volume_stroops: number }
  // entries for the last 30 days.
  //
  // The chart normalises volumes to XLM (divide by 1e7) for display.

  function generateMockDailyVolumes() {
    const now = Math.floor(Date.now() / 1000);
    const DAY = 86400;
    const volumes = [];
    for (let i = 29; i >= 0; i--) {
      volumes.push({
        timestamp_secs: now - i * DAY,
        // random volume 0.5 XLM – 50 XLM in stroops
        volume_stroops: Math.floor((0.5 + Math.random() * 49.5) * 1e7),
      });
    }
    return volumes;
  }

  function getMerchantStats() {
    // Swap this with a live contract call when CONTRACT_ID is available.
    return Promise.resolve({ daily_volumes: generateMockDailyVolumes() });
  }

  // ── 2. Aggregation helpers ──────────────────────────────────────────────────

  const DAY_MS = 86400 * 1000;
  const WEEK_MS = 7 * DAY_MS;

  /**
   * Aggregate raw daily entries into weekly buckets.
   * @param {Array<{timestamp_secs:number, volume_stroops:number}>} daily
   * @returns {Array<{label:string, volumeXlm:number}>}
   */
  function aggregateWeekly(daily) {
    const buckets = new Map();
    for (const entry of daily) {
      const d = new Date(entry.timestamp_secs * 1000);
      // ISO week start (Monday)
      const day = d.getDay(); // 0=Sun
      const diff = (day === 0 ? -6 : 1 - day);
      const weekStart = new Date(d);
      weekStart.setDate(d.getDate() + diff);
      weekStart.setHours(0, 0, 0, 0);
      const key = weekStart.toISOString().slice(0, 10);
      buckets.set(key, (buckets.get(key) || 0) + entry.volume_stroops);
    }
    return Array.from(buckets.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, stroops]) => ({
        label: 'w/' + key.slice(5), // "w/MM-DD"
        volumeXlm: stroops / 1e7,
      }));
  }

  /**
   * @param {Array<{timestamp_secs:number, volume_stroops:number}>} daily
   * @returns {Array<{label:string, volumeXlm:number}>}
   */
  function aggregateDaily(daily) {
    return daily.map(entry => {
      const d = new Date(entry.timestamp_secs * 1000);
      const label = (d.getMonth() + 1) + '/' + d.getDate();
      return { label, volumeXlm: entry.volume_stroops / 1e7 };
    });
  }

  // ── 3. Canvas chart renderer ────────────────────────────────────────────────

  /**
   * Draw a line chart onto a <canvas> element.
   *
   * Colour palette is WCAG AA compliant and works in both light and dark modes:
   *   Line:  #0b66ff  (blue, contrast ≥ 4.5:1 on white and ≥ 3.1:1 on dark bg)
   *   Fill:  rgba(11,102,255,0.10) semi-transparent
   *   Grid:  #e2e8f0 / #2d3748  (light/dark)
   *   Text:  #475569 / #94a3b8  (light/dark)
   *
   * @param {HTMLCanvasElement} canvas
   * @param {Array<{label:string, volumeXlm:number}>} points
   */
  function drawChart(canvas, points) {
    const dpr = window.devicePixelRatio || 1;
    const W   = canvas.clientWidth  || canvas.parentElement.clientWidth  || 600;
    const H   = Math.min(Math.round(W * 0.38), 280); // ~38% aspect, max 280px

    canvas.width  = W * dpr;
    canvas.height = H * dpr;
    canvas.style.width  = W + 'px';
    canvas.style.height = H + 'px';

    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);

    // Detect dark mode
    const dark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    const COL  = {
      line:       '#0b66ff',
      fill:       'rgba(11,102,255,0.10)',
      grid:       dark ? '#2d3748' : '#e2e8f0',
      label:      dark ? '#94a3b8' : '#475569',
      tooltip_bg: dark ? '#1e293b' : '#fff',
      tooltip_fg: dark ? '#e2e8f0' : '#0b1726',
    };

    const PAD = { top: 24, right: 24, bottom: 40, left: 56 };
    const cW  = W - PAD.left - PAD.right;
    const cH  = H - PAD.top  - PAD.bottom;

    const maxVol  = Math.max(...points.map(p => p.volumeXlm), 0.001);
    const gridMax = Math.ceil(maxVol * 1.1 * 10) / 10;  // 10% headroom
    const GRID_LINES = 4;

    // Clear
    ctx.clearRect(0, 0, W, H);

    // ── Grid lines and Y labels ─────────────────────────────────────────────
    ctx.font      = `11px system-ui,Arial,sans-serif`;
    ctx.textAlign = 'right';
    for (let i = 0; i <= GRID_LINES; i++) {
      const val = (gridMax / GRID_LINES) * i;
      const y   = PAD.top + cH - (val / gridMax) * cH;

      ctx.strokeStyle = COL.grid;
      ctx.lineWidth   = 1;
      ctx.beginPath();
      ctx.moveTo(PAD.left, y);
      ctx.lineTo(PAD.left + cW, y);
      ctx.stroke();

      ctx.fillStyle = COL.label;
      ctx.fillText(val.toFixed(1), PAD.left - 6, y + 4);
    }

    // Y-axis title
    ctx.save();
    ctx.translate(12, PAD.top + cH / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.textAlign = 'center';
    ctx.fillStyle = COL.label;
    ctx.fillText('XLM', 0, 0);
    ctx.restore();

    if (!points.length) return;

    // ── Compute point coordinates ───────────────────────────────────────────
    const xs = points.map((_, i) => PAD.left + (i / (points.length - 1 || 1)) * cW);
    const ys = points.map(p  => PAD.top + cH - (p.volumeXlm / gridMax) * cH);

    // ── Area fill ───────────────────────────────────────────────────────────
    ctx.beginPath();
    ctx.moveTo(xs[0], PAD.top + cH);
    xs.forEach((x, i) => ctx.lineTo(x, ys[i]));
    ctx.lineTo(xs[xs.length - 1], PAD.top + cH);
    ctx.closePath();
    ctx.fillStyle = COL.fill;
    ctx.fill();

    // ── Line ────────────────────────────────────────────────────────────────
    ctx.beginPath();
    ctx.moveTo(xs[0], ys[0]);
    xs.forEach((x, i) => { if (i > 0) ctx.lineTo(x, ys[i]); });
    ctx.strokeStyle = COL.line;
    ctx.lineWidth   = 2;
    ctx.lineJoin    = 'round';
    ctx.stroke();

    // ── Data point dots ─────────────────────────────────────────────────────
    xs.forEach((x, i) => {
      ctx.beginPath();
      ctx.arc(x, ys[i], 3.5, 0, Math.PI * 2);
      ctx.fillStyle   = COL.line;
      ctx.fill();
      ctx.strokeStyle = dark ? '#1a1f2e' : '#fff';
      ctx.lineWidth   = 1.5;
      ctx.stroke();
    });

    // ── X-axis labels (thin out when many points) ───────────────────────────
    const step  = points.length > 14 ? Math.ceil(points.length / 7) : 1;
    ctx.fillStyle = COL.label;
    ctx.textAlign = 'center';
    ctx.font      = '10px system-ui,Arial,sans-serif';
    points.forEach((p, i) => {
      if (i % step !== 0 && i !== points.length - 1) return;
      ctx.fillText(p.label, xs[i], H - PAD.bottom + 16);
    });
  }

  // ── 4. Hover tooltip ────────────────────────────────────────────────────────

  let currentPoints = [];
  let currentCanvas = null;

  function attachTooltip(canvas) {
    currentCanvas = canvas;
    canvas.addEventListener('mousemove', onMouseMove);
    canvas.addEventListener('mouseleave', onMouseLeave);
    canvas.addEventListener('touchmove', onTouchMove, { passive: true });
  }

  function onMouseMove(e) {
    const rect = currentCanvas.getBoundingClientRect();
    showTooltip(e.clientX - rect.left, e.clientY - rect.top);
  }
  function onTouchMove(e) {
    const rect = currentCanvas.getBoundingClientRect();
    const t = e.touches[0];
    showTooltip(t.clientX - rect.left, t.clientY - rect.top);
  }
  function onMouseLeave() { hideTooltip(); }

  let tooltipEl = null;
  function ensureTooltip() {
    if (!tooltipEl) {
      tooltipEl = document.createElement('div');
      tooltipEl.style.cssText = [
        'position:absolute', 'pointer-events:none', 'display:none',
        'background:#fff', 'border:1px solid #e2e8f0', 'border-radius:6px',
        'padding:6px 10px', 'font-size:12px', 'box-shadow:0 2px 8px rgba(0,0,0,.12)',
        'color:#0b1726', 'white-space:nowrap', 'z-index:10',
      ].join(';');
      document.getElementById('trend-section').style.position = 'relative';
      document.getElementById('trend-section').appendChild(tooltipEl);
    }
  }

  function showTooltip(mx, my) {
    if (!currentPoints.length) return;
    ensureTooltip();

    const W   = currentCanvas.clientWidth;
    const PAD = { left: 56, right: 24, top: 24, bottom: 40 };
    const cW  = W - PAD.left - PAD.right;
    const step = cW / (currentPoints.length - 1 || 1);
    const idx  = Math.round(Math.max(0, Math.min(currentPoints.length - 1, (mx - PAD.left) / step)));
    const pt   = currentPoints[idx];
    if (!pt) return;

    tooltipEl.textContent = `${pt.label}: ${pt.volumeXlm.toFixed(2)} XLM`;
    tooltipEl.style.display = 'block';

    const canvasRect = currentCanvas.getBoundingClientRect();
    const sectionRect = document.getElementById('trend-section').getBoundingClientRect();
    const offsetX = canvasRect.left - sectionRect.left;
    const offsetY = canvasRect.top  - sectionRect.top;
    tooltipEl.style.left = (offsetX + mx + 12) + 'px';
    tooltipEl.style.top  = (offsetY + my - 28) + 'px';
  }
  function hideTooltip() {
    if (tooltipEl) tooltipEl.style.display = 'none';
  }

  // ── 5. Controller ───────────────────────────────────────────────────────────

  let rawDaily    = [];
  let aggregation = 'daily'; // 'daily' | 'weekly'

  function renderChart() {
    const canvas   = document.getElementById('volumeChart');
    const emptyEl  = document.getElementById('trend-empty');
    const points   = aggregation === 'weekly'
      ? aggregateWeekly(rawDaily)
      : aggregateDaily(rawDaily);

    if (!points.length || points.every(p => p.volumeXlm === 0)) {
      canvas.style.display  = 'none';
      emptyEl.style.display = 'block';
      return;
    }
    canvas.style.display  = 'block';
    emptyEl.style.display = 'none';
    currentPoints         = points;
    drawChart(canvas, points);
    attachTooltip(canvas);
  }

  function setAggregation(mode) {
    aggregation = mode;
    const daily  = document.getElementById('agg-daily');
    const weekly = document.getElementById('agg-weekly');
    daily.classList.toggle('agg-active', mode === 'daily');
    daily.setAttribute('aria-pressed', String(mode === 'daily'));
    weekly.classList.toggle('agg-active', mode === 'weekly');
    weekly.setAttribute('aria-pressed', String(mode === 'weekly'));
    renderChart();
  }

  // Toggle buttons
  document.getElementById('agg-daily') .addEventListener('click', () => setAggregation('daily'));
  document.getElementById('agg-weekly').addEventListener('click', () => setAggregation('weekly'));

  // Redraw on resize for responsiveness
  let resizeTimer;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(renderChart, 120);
  });

  // Redraw when colour scheme changes
  window.matchMedia('(prefers-color-scheme: dark)')
    .addEventListener('change', renderChart);

  // Load data and draw initial chart
  getMerchantStats().then(stats => {
    rawDaily = stats.daily_volumes || [];
    renderChart();
  }).catch(err => {
    console.error('[VolumeChart] failed to load stats:', err);
    document.getElementById('trend-empty').style.display = 'block';
  });
})();
