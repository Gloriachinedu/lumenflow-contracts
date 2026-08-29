/**
 * LumenFlow Shared Application Store
 *
 * A lightweight, event-driven state container that eliminates the duplicated
 * per-page state (filters, CONTRACT_ID, RPC_URL, etc.) scattered across the
 * frontend HTML files.
 *
 * Usage:
 *   import LumenFlowStore from './store.js';
 *
 *   // Or, when loaded as a plain <script> tag:
 *   const store = window.LumenFlowStore;
 *
 * Subscribing to state changes:
 *   store.subscribe((state, changed) => {
 *     if (changed.includes('filters')) updateFilterUI(state.filters);
 *   });
 *
 * Updating state:
 *   store.set({ filters: { ...store.get().filters, status: 'Completed' } });
 *
 * Resetting a slice:
 *   store.resetFilters();
 */

(function (root, factory) {
  // UMD wrapper – works as an ES module, CommonJS module, or plain browser global.
  if (typeof define === 'function' && define.amd) {
    define([], factory);
  } else if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory();
  } else {
    root.LumenFlowStore = factory();
  }
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // ── Default filter state shared by history pages ──────────────────────────

  const DEFAULT_FILTERS = Object.freeze({
    date_start: '',
    date_end:   '',
    amount_min: '',
    amount_max: '',
    token:      '',
    status:     'Any',
  });

  // ── Default configuration (overridden by window.LUMENFLOW_* globals) ───────

  const DEFAULT_CONFIG = Object.freeze({
    contractId: (typeof window !== 'undefined' && window.LUMENFLOW_CONTRACT_ID) || '',
    rpcUrl:     (typeof window !== 'undefined' && window.LUMENFLOW_RPC_URL)     || 'https://soroban-testnet.stellar.org',
    network:    (typeof window !== 'undefined' && window.LUMENFLOW_NETWORK)     || 'testnet',
  });

  // ── Initial application state ─────────────────────────────────────────────

  function buildInitialState() {
    return {
      // Shared Stellar/Soroban config
      config: { ...DEFAULT_CONFIG },

      // Payment-history filter state (used by history.html, payment-history*.html)
      filters: { ...DEFAULT_FILTERS },

      // Multisig payment state (used by multisig.html)
      multisig: null, // { paymentId, merchantAddress, tokenAddress, amount, signers, required, signatures: Set }

      // Receipt / currently viewed payment (used by receipt.html)
      receipt: null, // { payment, merchant, refunds }

      // UI state
      ui: {
        loading:  false,
        error:    null,   // string | null
        toast:    null,   // { message, type: 'success' | 'error' | 'info' } | null
      },
    };
  }

  // ── Store factory ──────────────────────────────────────────────────────────

  function createStore() {
    let _state = buildInitialState();
    const _listeners = [];

    /**
     * Return a copy of the current state.
     * Simple sub-objects (filters, config, ui) are deep-cloned via JSON
     * round-trip so callers cannot accidentally mutate them.
     * The `multisig` and `receipt` slices are returned by reference because
     * they may contain non-serialisable values (e.g. a Set of signatures);
     * callers must treat them as read-only or use store.set() to update them.
     */
    function get() {
      var clone = Object.assign({}, _state);
      // Deep-clone the plain-object slices
      if (_state.filters) clone.filters = Object.assign({}, _state.filters);
      if (_state.config)  clone.config  = Object.assign({}, _state.config);
      if (_state.ui)      clone.ui      = Object.assign({}, _state.ui);
      return clone;
    }

    /**
     * Merge `partial` into the top-level state keys and notify all listeners.
     *
     * @param {Partial<typeof _state>} partial
     */
    function set(partial) {
      const changed = Object.keys(partial).filter(
        k => partial[k] !== _state[k]
      );

      if (changed.length === 0) return;

      _state = Object.assign({}, _state, partial);

      _listeners.forEach(function (fn) {
        try { fn(_state, changed); }
        catch (e) { console.error('[LumenFlowStore] listener error:', e); }
      });
    }

    /**
     * Subscribe to state changes.
     * Returns an unsubscribe function.
     *
     * @param {(state: object, changed: string[]) => void} listener
     * @returns {() => void}
     */
    function subscribe(listener) {
      _listeners.push(listener);
      return function unsubscribe() {
        const idx = _listeners.indexOf(listener);
        if (idx !== -1) _listeners.splice(idx, 1);
      };
    }

    // ── Convenience helpers ────────────────────────────────────────────────

    /**
     * Update one or more filter fields and notify listeners.
     *
     * @param {Partial<typeof DEFAULT_FILTERS>} updates
     */
    function setFilters(updates) {
      set({ filters: Object.assign({}, _state.filters, updates) });
    }

    /**
     * Reset all filters to their defaults.
     */
    function resetFilters() {
      set({ filters: { ...DEFAULT_FILTERS } });
    }

    /**
     * Remove a single filter by key (reverts it to its default value).
     *
     * @param {keyof typeof DEFAULT_FILTERS} key
     */
    function removeFilter(key) {
      const update = {};
      update[key] = DEFAULT_FILTERS[key] !== undefined ? DEFAULT_FILTERS[key] : '';
      setFilters(update);
    }

    /**
     * Initialise filters from the current URL's query params and notify.
     */
    function initFiltersFromUrl() {
      if (typeof window === 'undefined') return;
      const params = new URLSearchParams(window.location.search);
      const updates = {};

      Object.keys(DEFAULT_FILTERS).forEach(function (key) {
        if (params.has(key)) {
          updates[key] = params.get(key);
        }
      });

      if (Object.keys(updates).length > 0) {
        setFilters(updates);
      }
    }

    /**
     * Serialise current active filters into the URL query string.
     */
    function pushFiltersToUrl() {
      if (typeof window === 'undefined') return;
      const { filters } = _state;
      const params = new URLSearchParams();

      Object.keys(filters).forEach(function (key) {
        if (filters[key] && filters[key] !== 'Any') {
          params.set(key, filters[key]);
        }
      });

      const newUrl = window.location.pathname +
        (params.toString() ? '?' + params.toString() : '');
      window.history.pushState({}, '', newUrl);
    }

    /**
     * Display a transient toast notification.
     *
     * @param {string} message
     * @param {'success'|'error'|'info'} [type='info']
     * @param {number} [duration=4000]  ms before auto-dismiss (0 = no auto-dismiss)
     */
    function showToast(message, type, duration) {
      type     = type     || 'info';
      duration = duration !== undefined ? duration : 4000;

      set({ ui: Object.assign({}, _state.ui, { toast: { message: message, type: type } }) });

      if (duration > 0) {
        setTimeout(function () {
          if (_state.ui.toast && _state.ui.toast.message === message) {
            set({ ui: Object.assign({}, _state.ui, { toast: null }) });
          }
        }, duration);
      }
    }

    /**
     * Dismiss the current toast immediately.
     */
    function dismissToast() {
      set({ ui: Object.assign({}, _state.ui, { toast: null }) });
    }

    /**
     * Set loading state.
     *
     * @param {boolean} loading
     */
    function setLoading(loading) {
      set({ ui: Object.assign({}, _state.ui, { loading: !!loading } ) });
    }

    /**
     * Set or clear the global error message.
     *
     * @param {string|null} error
     */
    function setError(error) {
      set({ ui: Object.assign({}, _state.ui, { error: error || null }) });
    }

    /**
     * Return active filter entries (non-default, non-empty values).
     *
     * @returns {Array<{key: string, value: string}>}
     */
    function getActiveFilters() {
      const { filters } = _state;
      return Object.keys(filters)
        .filter(function (k) { return filters[k] && filters[k] !== DEFAULT_FILTERS[k]; })
        .map(function (k)    { return { key: k, value: filters[k] }; });
    }

    /**
     * Reset entire store back to initial state (useful for testing).
     */
    function reset() {
      _state = buildInitialState();
      _listeners.forEach(function (fn) {
        try { fn(_state, Object.keys(_state)); }
        catch (e) { /* ignore */ }
      });
    }

    return {
      get:                get,
      set:                set,
      subscribe:          subscribe,
      setFilters:         setFilters,
      resetFilters:       resetFilters,
      removeFilter:       removeFilter,
      initFiltersFromUrl: initFiltersFromUrl,
      pushFiltersToUrl:   pushFiltersToUrl,
      showToast:          showToast,
      dismissToast:       dismissToast,
      setLoading:         setLoading,
      setError:           setError,
      getActiveFilters:   getActiveFilters,
      reset:              reset,

      // Expose defaults so consumers can reference them without duplicating them
      DEFAULT_FILTERS: DEFAULT_FILTERS,
      DEFAULT_CONFIG:  DEFAULT_CONFIG,
    };
  }

  return createStore();
}));
