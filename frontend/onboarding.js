  // ── State ──────────────────────────────────────────────────────────────────
  const form = {
    walletAddress: '',
    name: '',
    description: '',
    email: '',
    category: '',
    isDemo: false,
  };

  let currentStep = 1;

  // ── Step navigation ────────────────────────────────────────────────────────
  function goToStep(n) {
    document.getElementById(`step-${currentStep}`).classList.remove('active');
    document.getElementById(`step-node-${currentStep}`).classList.remove('active');
    if (n > currentStep) {
      document.getElementById(`step-node-${currentStep}`).classList.add('completed');
    } else {
      // going back — remove completed from current
      document.getElementById(`step-node-${currentStep}`).classList.remove('completed');
    }
    currentStep = n;
    document.getElementById(`step-${n}`).classList.add('active');
    document.getElementById(`step-node-${n}`).classList.add('active');
    document.getElementById(`step-node-${n}`).setAttribute('aria-current', 'step');

    if (n === 4) buildReview();
    if (n === 5) document.getElementById('done-address').textContent =
      form.walletAddress || 'G…(demo address)';

    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  // ── Wallet connect ─────────────────────────────────────────────────────────
  async function connectFreighter() {
    if (window.freighter) {
      try {
        const resp = await window.freighter.getConnectedAccount();
        setWallet(resp.publicKey, 'btn-freighter');
      } catch {
        alert('Freighter connection failed. Make sure the extension is installed and unlocked.');
      }
    } else {
      alert('Freighter extension not found. Install it from https://www.freighter.app/');
    }
  }

  async function connectAlbedo() {
    if (window.albedo) {
      try {
        const resp = await window.albedo.publicKey({});
        setWallet(resp.pubkey, 'btn-albedo');
      } catch {
        alert('Albedo connection failed.');
      }
    } else {
      alert('Albedo not available. Visit https://albedo.link/');
    }
  }

  function setWallet(address, btnId) {
    form.walletAddress = address;
    document.getElementById('wallet-address').textContent = address;
    document.querySelectorAll('.wallet-btn').forEach(b => b.classList.remove('connected'));
    document.getElementById(btnId).classList.add('connected');
  }

  function useDemo() {
    form.isDemo = true;
    setWallet('GDEMO…LUMENFLOW1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'btn-freighter');
  }

  // ── Form validation (step 3) ───────────────────────────────────────────────
  function validateAndNext() {
    const name     = document.getElementById('biz-name').value.trim();
    const desc     = document.getElementById('biz-desc').value.trim();
    const email    = document.getElementById('biz-email').value.trim();
    const category = document.getElementById('biz-category').value;

    let valid = true;

    function setError(id, fieldId, show) {
      const err   = document.getElementById(id);
      const input = document.getElementById(fieldId);
      err.classList.toggle('visible', show);
      if (input) input.classList.toggle('error', show);
      if (show) valid = false;
    }

    setError('err-biz-name',     'biz-name',     !name);
    setError('err-biz-desc',     'biz-desc',      !desc);
    setError('err-biz-email',    'biz-email',     !email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email));
    setError('err-biz-category', 'biz-category',  !category);

    if (!valid) return;

    form.name        = name;
    form.description = desc;
    form.email       = email;
    form.category    = category;

    goToStep(4);
  }

  // ── Review summary (step 4) ────────────────────────────────────────────────
  function buildReview() {
    const rows = [
      { label: 'Wallet Address', value: form.walletAddress || '(demo)' },
      { label: 'Business Name',  value: form.name },
      { label: 'Description',    value: form.description },
      { label: 'Contact Email',  value: form.email },
      { label: 'Category',       value: form.category },
    ];
    document.getElementById('review-summary').innerHTML = rows.map(r => `
      <div class="review-row">
        <span class="review-label">${r.label}</span>
        <span class="review-value">${escapeHtml(r.value)}</span>
      </div>`).join('');
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  // ── Register (step 4 → 5) ──────────────────────────────────────────────────
  async function registerMerchant() {
    const btn = document.getElementById('btn-register');
    const status = document.getElementById('tx-status');

    btn.disabled = true;
    btn.textContent = '⏳ Submitting…';
    status.className = 'tx-status pending';
    status.textContent = '⏳ Transaction pending — waiting for network confirmation…';

    // Demo: simulate a 2-second network delay
    await new Promise(r => setTimeout(r, 2000));

    status.className = 'tx-status success';
    status.textContent = '✅ Registration confirmed! Your merchant profile is live.';
    btn.textContent = '✅ Registered';

    setTimeout(() => goToStep(5), 1000);
  }
