/* Accessible toast notifications shared by the frontend pages. */
(function (global, document) {
  const REGIONS = {
    info: { id: 'toast-status-region', role: 'status', live: 'polite' },
    error: { id: 'toast-alert-region', role: 'alert', live: 'assertive' },
  };

  function ensureRegion(type) {
    const config = REGIONS[type] || REGIONS.info;
    let region = document.getElementById(config.id);
    if (region) return region;

    region = document.createElement('div');
    region.id = config.id;
    region.className = 'toast-region';
    region.setAttribute('role', config.role);
    region.setAttribute('aria-live', config.live);
    region.setAttribute('aria-atomic', 'false');
    document.body.appendChild(region);
    return region;
  }

  function dismissToast(toast) {
    if (toast && toast.parentNode) toast.remove();
  }

  function showToast(message, type, timeout) {
    const normalizedType = type === 'error' ? 'error' : 'info';
    const duration = Number.isFinite(timeout) ? Math.max(0, timeout) : 5000;
    const toast = document.createElement('div');
    toast.className = `toast toast-${normalizedType}`;
    toast.textContent = String(message);
    toast.tabIndex = -1;

    const region = ensureRegion(normalizedType);
    region.appendChild(toast);
    const timer = global.setTimeout(() => dismissToast(toast), duration);
    toast.addEventListener('click', () => {
      global.clearTimeout(timer);
      dismissToast(toast);
    }, { once: true });
    return toast;
  }

  function initializeRegions() {
    ensureRegion('info');
    ensureRegion('error');
  }

  global.showToast = showToast;
  global.dismissToast = dismissToast;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeRegions, { once: true });
  } else {
    initializeRegions();
  }
}(window, document));
