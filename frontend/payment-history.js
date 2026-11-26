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
    const span = document.createElement('span');
    span.className = cls ? `badge ${cls}` : 'badge';
    span.textContent = label;
    return span;
  }

  function renderPage(sorted) {
    const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
    if (currentPage > totalPages) currentPage = totalPages;

    const start = (currentPage - 1) * PAGE_SIZE;
    const page  = sorted.slice(start, start + PAGE_SIZE);

    // Table rows
    const tbody = document.getElementById('table-body');
    const cardsList = document.getElementById('cards-list');
    tbody.setAttribute('aria-busy', 'false');
    cardsList.setAttribute('aria-busy', 'false');
    tbody.replaceChildren();
    if (page.length === 0) {
      const tr = document.createElement('tr');
      const td = document.createElement('td');
      td.colSpan = 5;
      td.className = 'empty';
      td.textContent = 'No payments found.';
      tr.appendChild(td);
      tbody.appendChild(tr);
    } else {
      page.forEach(p => {
        const tr = document.createElement('tr');

        const orderTd = document.createElement('td');
        const orderSpan = document.createElement('span');
        orderSpan.className = 'order-id';
        orderSpan.textContent = p.order_id;
        orderTd.appendChild(orderSpan);
        tr.appendChild(orderTd);

        const merchantTd = document.createElement('td');
        merchantTd.textContent = p.merchant_address;
        tr.appendChild(merchantTd);

        const amountTd = document.createElement('td');
        amountTd.className = 'amount';
        amountTd.textContent = `${p.amount.toLocaleString()} XLM`;
        tr.appendChild(amountTd);

        const statusTd = document.createElement('td');
        statusTd.appendChild(statusBadge(p.status));
        tr.appendChild(statusTd);

        const dateTd = document.createElement('td');
        dateTd.textContent = p.paid_at;
        tr.appendChild(dateTd);

        tbody.appendChild(tr);
      });
    }

    // Cards
    cardsList.replaceChildren();
    if (page.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'empty';
      empty.textContent = 'No payments found.';
      cardsList.appendChild(empty);
    } else {
      page.forEach(p => {
        const card = document.createElement('div');
        card.className = 'payment-card';

        const header = document.createElement('div');
        header.className = 'card-header';
        const cardOrderId = document.createElement('span');
        cardOrderId.className = 'card-order-id';
        cardOrderId.textContent = p.order_id;
        const cardAmount = document.createElement('span');
        cardAmount.className = 'card-amount';
        cardAmount.textContent = `${p.amount.toLocaleString()} XLM`;
        header.appendChild(cardOrderId);
        header.appendChild(cardAmount);
        card.appendChild(header);

        const merchantRow = document.createElement('div');
        merchantRow.className = 'card-row';
        const merchantLabel = document.createElement('span');
        merchantLabel.className = 'card-label';
        merchantLabel.textContent = 'Merchant';
        const merchantValue = document.createElement('span');
        merchantValue.textContent = p.merchant_address;
        merchantRow.appendChild(merchantLabel);
        merchantRow.appendChild(merchantValue);
        card.appendChild(merchantRow);

        const statusRow = document.createElement('div');
        statusRow.className = 'card-row';
        const statusLabel = document.createElement('span');
        statusLabel.className = 'card-label';
        statusLabel.textContent = 'Status';
        const statusValue = document.createElement('span');
        statusValue.appendChild(statusBadge(p.status));
        statusRow.appendChild(statusLabel);
        statusRow.appendChild(statusValue);
        card.appendChild(statusRow);

        const dateRow = document.createElement('div');
        dateRow.className = 'card-row';
        const dateLabel = document.createElement('span');
        dateLabel.className = 'card-label';
        dateLabel.textContent = 'Date';
        const dateValue = document.createElement('span');
        dateValue.textContent = p.paid_at;
        dateRow.appendChild(dateLabel);
        dateRow.appendChild(dateValue);
        card.appendChild(dateRow);

        cardsList.appendChild(card);
      });
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
