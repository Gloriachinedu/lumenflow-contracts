  // ── Mock data (replace with contract call) ─────────────────────────────────
  const MOCK_PAYMENTS = [
    { order_id: 'ORDER_001', merchant_address: 'GDUT...XZ1A', amount: 1000, status: 'Completed',          paid_at: '2026-06-01' },
    { order_id: 'ORDER_002', merchant_address: 'GCMR...Y9KP', amount: 4500, status: 'PartiallyRefunded',  paid_at: '2026-06-05' },
    { order_id: 'ORDER_003', merchant_address: 'GDUT...XZ1A', amount: 750,  status: 'Completed',          paid_at: '2026-06-08' },
    { order_id: 'ORDER_004', merchant_address: 'GCMR...Y9KP', amount: 200,  status: 'FullyRefunded',      paid_at: '2026-06-10' },
    { order_id: 'ORDER_005', merchant_address: 'GDUT...XZ1A', amount: 3200, status: 'Completed',          paid_at: '2026-06-12' },
    { order_id: 'ORDER_006', merchant_address: 'GCMR...Y9KP', amount: 600,  status: 'Completed',          paid_at: '2026-06-14' },
    { order_id: 'ORDER_007', merchant_address: 'GDUT...XZ1A', amount: 980,  status: 'PartiallyRefunded',  paid_at: '2026-06-15' },
    { order_id: 'ORDER_008', merchant_address: 'GCMR...Y9KP', amount: 120,  status: 'Completed',          paid_at: '2026-06-17' },
    { order_id: 'ORDER_009', merchant_address: 'GDUT...XZ1A', amount: 8750, status: 'Completed',          paid_at: '2026-06-18' },
    { order_id: 'ORDER_010', merchant_address: 'GCMR...Y9KP', amount: 310,  status: 'FullyRefunded',      paid_at: '2026-06-20' },
    { order_id: 'ORDER_011', merchant_address: 'GDUT...XZ1A', amount: 2200, status: 'Completed',          paid_at: '2026-06-21' },
    { order_id: 'ORDER_012', merchant_address: 'GCMR...Y9KP', amount: 540,  status: 'Completed',          paid_at: '2026-06-23' },
  ];

  const PAGE_SIZE = 5;
  let currentPage = 1;
  let sortField = 'paid_at';
  let sortAsc = false;
  let filtered = [...MOCK_PAYMENTS];

  // ── Filtering ──────────────────────────────────────────────────────────────
  function applyFilters() {
    const search = document.getElementById('search').value.trim().toLowerCase();
    const status = document.getElementById('status-filter').value;

    filtered = MOCK_PAYMENTS.filter(p => {
      const matchSearch = !search || p.order_id.toLowerCase().includes(search) ||
                          p.merchant_address.toLowerCase().includes(search);
      const matchStatus = !status || p.status === status;
      return matchSearch && matchStatus;
    });

    currentPage = 1;
    sortAndRender();
  }

  function resetFilters() {
    document.getElementById('search').value = '';
    document.getElementById('status-filter').value = '';
    filtered = [...MOCK_PAYMENTS];
    currentPage = 1;
    sortAndRender();
  }

  // ── Sorting ────────────────────────────────────────────────────────────────
  function sortBy(field) {
    if (sortField === field) {
      sortAsc = !sortAsc;
    } else {
      sortField = field;
      sortAsc = true;
    }
    // Update header icons
    document.querySelectorAll('thead th').forEach(th => th.classList.remove('active'));
    const headers = ['order_id', 'merchant_address', 'amount', 'status', 'paid_at'];
    const idx = headers.indexOf(field);
    if (idx !== -1) {
      const ths = document.querySelectorAll('thead th');
      ths[idx].classList.add('active');
      ths[idx].querySelector('.sort-icon').textContent = sortAsc ? '↑' : '↓';
    }
    sortAndRender();
  }

  function sortAndRender() {
    const sorted = [...filtered].sort((a, b) => {
      const av = a[sortField], bv = b[sortField];
      if (av < bv) return sortAsc ? -1 : 1;
      if (av > bv) return sortAsc ? 1 : -1;
      return 0;
    });
    renderPage(sorted);
  }

  // ── Rendering ──────────────────────────────────────────────────────────────
  function statusBadge(status) {
    const map = {
      Completed:          ['badge-completed',      'Completed'],
      PartiallyRefunded:  ['badge-partial',         'Partial Refund'],
      FullyRefunded:      ['badge-fully-refunded',  'Fully Refunded'],
    };
    const [cls, label] = map[status] || ['', status];
    return `<span class="badge ${cls}">${label}</span>`;
  }

  function renderPage(sorted) {
    const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
    if (currentPage > totalPages) currentPage = totalPages;

    const start = (currentPage - 1) * PAGE_SIZE;
    const page  = sorted.slice(start, start + PAGE_SIZE);

    // Table rows
    const tbody = document.getElementById('table-body');
    if (page.length === 0) {
      tbody.innerHTML = '<tr><td colspan="5" class="empty">No payments found.</td></tr>';
    } else {
      tbody.innerHTML = page.map(p => `
        <tr>
          <td><span class="order-id">${p.order_id}</span></td>
          <td>${p.merchant_address}</td>
          <td class="amount">${p.amount.toLocaleString()} XLM</td>
          <td>${statusBadge(p.status)}</td>
          <td>${p.paid_at}</td>
        </tr>`).join('');
    }

    // Cards
    const cardsList = document.getElementById('cards-list');
    if (page.length === 0) {
      cardsList.innerHTML = '<div class="empty">No payments found.</div>';
    } else {
      cardsList.innerHTML = page.map(p => `
        <div class="payment-card">
          <div class="card-header">
            <span class="card-order-id">${p.order_id}</span>
            <span class="card-amount">${p.amount.toLocaleString()} XLM</span>
          </div>
          <div class="card-row">
            <span class="card-label">Merchant</span>
            <span>${p.merchant_address}</span>
          </div>
          <div class="card-row">
            <span class="card-label">Status</span>
            <span>${statusBadge(p.status)}</span>
          </div>
          <div class="card-row">
            <span class="card-label">Date</span>
            <span>${p.paid_at}</span>
          </div>
        </div>`).join('');
    }

    // Pagination controls
    document.getElementById('page-info').textContent =
      sorted.length === 0 ? 'No results' : `Page ${currentPage} of ${totalPages} (${sorted.length} records)`;
    document.getElementById('prev-btn').disabled = currentPage <= 1;
    document.getElementById('next-btn').disabled = currentPage >= totalPages;
  }

  // ── Pagination ─────────────────────────────────────────────────────────────
  function prevPage() { if (currentPage > 1) { currentPage--; sortAndRender(); } }
  function nextPage() { currentPage++; sortAndRender(); }

  // ── Init ───────────────────────────────────────────────────────────────────
  sortAndRender();
