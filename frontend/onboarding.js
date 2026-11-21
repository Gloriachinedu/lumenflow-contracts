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
  const TOTAL_STEPS = 5;

  // ── Step persistence ───────────────────────────────────────────────────────
  const STEP_STORAGE_KEY = 'lumensflow:onboarding:step';

  function saveStep(n) {
    try {
      sessionStorage.setItem(STEP_STORAGE_KEY, String(n));
    } catch { /* storage unavailable — ignore */ }
    try {
      history.replaceState({ ...(history.state || {}), onboardingStep: n }, '');
    } catch { /* history unavailable — ignore */ }
  }

  function loadSavedStep() {
    let n = 1;
    try {
      const fromHistory = history.state && history.state.onboardingStep;
      const fromStorage = parseInt(sessionStorage.getItem(STEP_STORAGE_KEY), 10);
      n = fromHistory || fromStorage || 1;
    } catch { /* ignore */ }
    if (!Number.isInteger(n) || n < 1 || n > TOTAL_STEPS) n = 1;
    return n;
  }

  // ── Step navigation ────────────────────────────────────────────────────────
  function renderStepper() {
    for (let i = 1; i <= TOTAL_STEPS; i++) {
      const node = document.getElementById(`step-node-${i}`);
      if (!node) continue;
      const isCurrent = i === currentStep;
      const isCompleted = i < currentStep;
      node.classList.toggle('active', isCurrent);
      node.classList.toggle('completed', isCompleted);
      if (isCurrent) {
        node.setAttribute('aria-current', 'step');
      } else {
        node.removeAttribute('aria-current');
      }
      const marker = node.querySelector('.step-check');
      if (marker) marker.textContent = isCompleted ? '✓' : '';
    }
  }

  function goToStep(n, { persist = true } = {}) {
    if (!Number.isInteger(n) || n < 1 || n > TOTAL_STEPS) return;

    const prevPanel = document.getElementById(`step-${currentStep}`);
    if (prevPanel) prevPanel.classList.remove('active');

    currentStep = n;

    const nextPanel = document.getElementById(`step-${n}`);
    if (nextPanel) nextPanel.classList.add('active');

    renderStepper();

    if (n === 4) buildReview();
    if (n === 5) document.getElementById('done-address').textContent =
      form.walletAddress || 'G…(demo address)';

    if (persist) saveStep(n);

    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  // ── Autosave (non-sensitive fields only) ───────────────────────────────────
  const AUTOSAVE_KEY = 'lumensflow:onboarding:form';
  // Allow-list of fields safe to persist. Anything matching the deny-list is
  // never serialized, even if it appears in the allow-list by mistake.
  const AUTOSAVE_FIELDS = ['biz-name', 'biz-desc', 'biz-email', 'biz-category'];
  const SENSITIVE_PATTERN = /private[\s_-]?key|seed[\s_-]?phrase|secret/i;

  function isSensitiveField(el) {
    if (!el) return true;
    const haystack = [el.id, el.name, el.type, el.getAttribute('autocomplete')]
      .filter(Boolean).join(' ');
    return SENSITIVE_PATTERN.test(haystack);
  }

  function collectAutosaveState() {
    const state = {};
    AUTOSAVE_FIELDS.forEach(id => {
      const el = document.getElementById(id);
      if (!el || isSensitiveField(el)) return;
      state[id] = el.value;
    });
    return state;
  }

  function writeAutosaveState() {
    try {
      sessionStorage.setItem(AUTOSAVE_KEY, JSON.stringify(collectAutosaveState()));
    } catch { /* storage unavailable — ignore */ }
  }

  function clearAutosaveState() {
    try {
      sessionStorage.removeItem(AUTOSAVE_KEY);
      sessionStorage.removeItem(STEP_STORAGE_KEY);
    } catch { /* ignore */ }
  }

  function restoreAutosaveState() {
    let saved = null;
    try {
      const raw = sessionStorage.getItem(AUTOSAVE_KEY);
      if (raw) saved = JSON.parse(raw);
    } catch { /* corrupt or unavailable — ignore */ }
    if (!saved || typeof saved !== 'object') return;

    const hasData = Object.values(saved).some(v => typeof v === 'string' && v.trim() !== '');
    if (!hasData) return;

    if (!window.confirm('Restore previous session?')) {
      clearAutosaveState();
      return;
    }

    AUTOSAVE_FIELDS.forEach(id => {
      const el = document.getElementById(id);
      if (!el || isSensitiveField(el)) return;
      if (typeof saved[id] === 'string') el.value = saved[id];
    });
  }

  function initAutosave() {
    AUTOSAVE_FIELDS.forEach(id => {
      const el = document.getElementById(id);
      if (!el || isSensitiveField(el)) return;
      el.addEventListener('input', writeAutosaveState);
    });
  }

  // ── Init ───────────────────────────────────────────────────────────────────
  function initOnboarding() {
    restoreAutosaveState();
    initAutosave();
    goToStep(loadSavedStep(), { persist: false });

    window.addEventListener('popstate', () => {
      goToStep(loadSavedStep(), { persist: false });
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initOnboarding);
  } else {
    initOnboarding();
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

    clearAutosaveState();

    setTimeout(() => goToStep(5), 1000);
  }
