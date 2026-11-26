/**
 * LumenFlow i18n Framework
 *
 * Lightweight, dependency-free i18n module for the LumenFlow frontend.
 *
 * Features:
 *  - Language auto-detection from navigator.language
 *  - Persistent language preference in localStorage
 *  - JSON-based locale files (en.json, es.json, pt.json)
 *  - DOM attribute translation via data-i18n="key.path"
 *  - Language switcher injection on any page
 *
 * Usage:
 *   import { i18n } from './i18n.js';
 *
 *   // Bootstrap (call once per page, awaits locale load)
 *   await i18n.init();
 *
 *   // Translate a key
 *   const label = i18n.t('history.title');
 *
 *   // Inject the language switcher into an existing element
 *   i18n.renderSwitcher(document.getElementById('my-nav'));
 */

// ── Supported locales ────────────────────────────────────────────────────────

/**
 * Map from BCP-47 language tag (prefix) to locale code.
 *
 * Every locale listed here MUST have a corresponding JSON file in
 * `frontend/locales/` containing every key present in `en.json`.
 * `scripts/check-i18n-locales.mjs` enforces this in CI — when adding a new
 * key, add it to all locale files at the same time.
 */
const SUPPORTED_LOCALES = {
  en: 'en',
  es: 'es',
  pt: 'pt',
};

const DEFAULT_LOCALE = 'en';
const STORAGE_KEY    = 'lf-lang';

/**
 * Built-in fallback translations for the payment history empty state.
 *
 * These are merged underneath the locale JSON loaded from ./locales so that
 * the empty-state keys always resolve through i18n.t() (and data-i18n
 * attributes) even if a locale file has not yet been updated.
 *
 * Keys:
 *   history.empty.title       → "No payments yet"
 *   history.empty.description → supporting message
 *   history.empty.cta         → "Create your first payment link"
 *   history.empty.illustrationAlt → alt text for the illustration
 */
const EMPTY_STATE_MESSAGES = {
  en: {
    history: {
      empty: {
        title: 'No payments yet',
        description: 'When you create a payment link, incoming payments will appear here.',
        cta: 'Create your first payment link',
        illustrationAlt: 'Illustration of an empty payment history',
      },
    },
  },
  es: {
    history: {
      empty: {
        title: 'Aún no hay pagos',
        description: 'Cuando crees un enlace de pago, los pagos recibidos aparecerán aquí.',
        cta: 'Crea tu primer enlace de pago',
        illustrationAlt: 'Ilustración de un historial de pagos vacío',
      },
    },
  },
  pt: {
    history: {
      empty: {
        title: 'Ainda não há pagamentos',
        description: 'Quando você criar um link de pagamento, os pagamentos recebidos aparecerão aqui.',
        cta: 'Crie seu primeiro link de pagamento',
        illustrationAlt: 'Ilustração de um histórico de pagamentos vazio',
      },
    },
  },
};

/** Relative path from the frontend root to the locales directory. */
const LOCALES_PATH = './locales';

// ── Internal state ────────────────────────────────────────────────────────────

let _locale   = DEFAULT_LOCALE;  // current locale code
let _messages = {};              // parsed JSON for the active locale
let _defaultMessages = null;     // parsed JSON for the default locale (error fallbacks)

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Resolve a dot-separated key path into the messages object.
 * e.g. "history.title" → messages.history.title
 *
 * @param {object} obj
 * @param {string} path
 * @returns {string|undefined}
 */
function resolvePath(obj, path) {
  return path.split('.').reduce((acc, key) => (acc && acc[key] !== undefined ? acc[key] : undefined), obj);
}

/**
 * Detect the best-matching supported locale from the browser's language list.
 * Falls back to DEFAULT_LOCALE if nothing matches.
 *
 * @returns {string} locale code ('en' | 'es' | 'pt')
 */
function detectBrowserLocale() {
  const langs = (navigator.languages && navigator.languages.length)
    ? Array.from(navigator.languages)
    : [navigator.language || navigator.userLanguage || DEFAULT_LOCALE];

  for (const lang of langs) {
    // Try exact match first (e.g. "es-MX" → "es")
    const prefix = lang.split('-')[0].toLowerCase();
    if (SUPPORTED_LOCALES[prefix]) return SUPPORTED_LOCALES[prefix];
  }

  return DEFAULT_LOCALE;
}

/**
 * Load a locale JSON file over the network.
 *
 * @param {string} locale
 * @returns {Promise<object>}
 */
async function loadLocale(locale) {
  const url = `${LOCALES_PATH}/${locale}.json`;
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`[i18n] Failed to load locale "${locale}" from ${url}: ${resp.status}`);
  const messages = await resp.json();

  // In development, warn about keys present in the base locale but missing
  // from the loaded locale. CI enforces full coverage via
  // scripts/check-i18n-locales.mjs, but this surfaces gaps at runtime too.
  if (locale !== DEFAULT_LOCALE) {
    try {
      const base = await loadLocale(DEFAULT_LOCALE);
      const missing = findMissingKeys(base, messages);
      if (missing.length) {
        console.warn(
          `[i18n] Locale "${locale}" is missing ${missing.length} key(s) present in "${DEFAULT_LOCALE}":`,
          missing
        );
      }
    } catch (_) {
      // Base locale unavailable — skip the coverage warning.
    }
  }

  return messages;
}

/**
 * Recursively collect dot-notation key paths that exist in `base` but not in
 * `target`. Only leaf (non-object) values are considered keys.
 *
 * @param {object} base
 * @param {object} target
 * @param {string} [prefix]
 * @returns {string[]}
 */
function findMissingKeys(base, target, prefix = '') {
  const missing = [];
  for (const key of Object.keys(base)) {
    const path = prefix ? `${prefix}.${key}` : key;
    const baseVal = base[key];
    const targetVal = target ? target[key] : undefined;

    if (baseVal !== null && typeof baseVal === 'object' && !Array.isArray(baseVal)) {
      missing.push(...findMissingKeys(baseVal, targetVal, path));
    } else if (targetVal === undefined) {
      missing.push(path);
    }
  }
  return missing;
}

/**
 * Deep-merge `source` into `target` without mutating either object.
 * Values from `source` take precedence; nested plain objects are merged.
 *
 * @param {object} target
 * @param {object} source
 * @returns {object}
 */
function deepMerge(target, source) {
  const out = { ...target };
  Object.keys(source || {}).forEach((key) => {
    const srcVal = source[key];
    const tgtVal = out[key];
    if (
      srcVal && typeof srcVal === 'object' && !Array.isArray(srcVal) &&
      tgtVal && typeof tgtVal === 'object' && !Array.isArray(tgtVal)
    ) {
      out[key] = deepMerge(tgtVal, srcVal);
    } else {
      out[key] = srcVal;
    }
  });
  return out;
}

/**
 * Load a locale and layer the built-in fallback messages underneath it,
 * so missing keys (e.g. the payment history empty state) still resolve.
 *
 * @param {string} locale
 * @returns {Promise<object>}
 */
async function loadLocaleWithFallbacks(locale) {
  const messages = await loadLocale(locale);
  return deepMerge(EMPTY_STATE_MESSAGES[locale] || {}, messages);
}

// ── Public API ────────────────────────────────────────────────────────────────

export const i18n = {
  /**
   * Returns the currently active locale code.
   * @returns {string}
   */
  get locale() { return _locale; },

  /**
   * Initialise the i18n module.
   *
   * Priority:
   *  1. localStorage preference ('lf-lang')
   *  2. Browser navigator.language auto-detection
   *  3. DEFAULT_LOCALE fallback
   *
   * After loading the locale, all [data-i18n] elements in the document are
   * translated and the <html lang> attribute is updated.
   *
   * @param {object} [opts]
   * @param {string} [opts.locale]   Force a specific locale (skips auto-detect)
   * @returns {Promise<void>}
   */
  async init(opts = {}) {
    let targetLocale = opts.locale
      || localStorage.getItem(STORAGE_KEY)
      || detectBrowserLocale();

    // Normalise and guard against unsupported values stored in localStorage
    if (!SUPPORTED_LOCALES[targetLocale]) {
      targetLocale = DEFAULT_LOCALE;
    }

    await this.setLocale(targetLocale);
  },

  /**
   * Switch to a new locale, persisting the choice and re-translating the page.
   *
   * @param {string} locale
   * @returns {Promise<void>}
   */
  async setLocale(locale) {
    if (!SUPPORTED_LOCALES[locale]) {
      console.warn(`[i18n] Unsupported locale "${locale}", falling back to "${DEFAULT_LOCALE}"`);
      locale = DEFAULT_LOCALE;
    }

    try {
      _messages = await loadLocaleWithFallbacks(locale);
      _locale   = locale;
      localStorage.setItem(STORAGE_KEY, locale);
    } catch (err) {
      console.error(err);
      if (locale !== DEFAULT_LOCALE) {
        // Graceful degradation: load the default locale instead
        _messages = await loadLocaleWithFallbacks(DEFAULT_LOCALE);
        _locale   = DEFAULT_LOCALE;
      }
    }

    // Keep a copy of the default locale's messages so error lookups can fall
    // back to it when a translation is missing in the active locale.
    if (_locale === DEFAULT_LOCALE) {
      _defaultMessages = _messages;
    } else if (!_defaultMessages) {
      try {
        _defaultMessages = await loadLocale(DEFAULT_LOCALE);
      } catch (err) {
        console.error(err);
      }
    }

    // Update <html lang> attribute for accessibility
    document.documentElement.setAttribute('lang', _locale);

    // Apply text direction (all supported locales are LTR; future RTL locales
    // will set "dir": "rtl" in their JSON)
    const dir = (_messages && _messages.dir) || 'ltr';
    document.documentElement.setAttribute('dir', dir);

    // Translate all marked elements in the document
    this.translatePage();

    // Sync the switcher UI if it exists
    this._syncSwitcher();
  },

  /**
   * Translate a key.
   *
   * Supports nested dot-notation paths (e.g. "history.title").
   * Returns the key itself if not found, so untranslated strings are visible.
   *
   * @param {string} key
   * @param {object} [vars] Named interpolation variables ({ count: 5 })
   * @returns {string}
   */
  t(key, vars) {
    let value = resolvePath(_messages, key);

    if (value === undefined) {
      console.warn(`[i18n] Missing key "${key}" in locale "${_locale}"`);
      return key;
    }

    if (typeof value !== 'string') return String(value);

    // Simple {{variable}} interpolation
    if (vars) {
      value = value.replace(/\{\{(\w+)\}\}/g, (_, name) =>
        vars[name] !== undefined ? String(vars[name]) : `{{${name}}}`
      );
    }

    return value;
  },

  /**
   * Translate all elements with the [data-i18n] attribute in the document.
   *
   * Attribute value syntax:
   *   data-i18n="key"                  → sets textContent
   *   data-i18n-attr="placeholder"     → sets the named attribute instead
   *   data-i18n-attr="aria-label"      → useful for icon buttons
   *
   * Example HTML:
   *   <h1 data-i18n="history.title"></h1>
   *   <input data-i18n="history.filterLabel" data-i18n-attr="placeholder" />
   */
  translatePage() {
    document.querySelectorAll('[data-i18n]').forEach((el) => {
      const key     = el.getAttribute('data-i18n');
      const attr    = el.getAttribute('data-i18n-attr');
      const translated = this.t(key);

      if (attr) {
        el.setAttribute(attr, translated);
      } else {
        el.textContent = translated;
      }
    });
  },

  /**
   * Inject a language switcher <div> into `container`.
   *
   * The switcher renders as an accessible <select> element.
   * Calling this multiple times on the same container will reuse the same element.
   *
   * @param {HTMLElement} container  Parent element to append the switcher into.
   */
  renderSwitcher(container) {
    if (!container) return;

    // Remove any existing switcher so we don't duplicate it
    const existing = container.querySelector('.lf-lang-switcher');
    if (existing) existing.remove();

    const wrapper = document.createElement('div');
    wrapper.className = 'lf-lang-switcher';
    wrapper.setAttribute('role', 'navigation');
    wrapper.setAttribute('aria-label', this.t('langSwitcher.label'));

    const label = document.createElement('label');
    label.setAttribute('for', 'lf-lang-select');
    label.className = 'lf-lang-label';
    label.textContent = this.t('langSwitcher.label') + ': ';

    const select = document.createElement('select');
    select.id = 'lf-lang-select';
    select.className = 'lf-lang-select';
    select.setAttribute('aria-label', this.t('langSwitcher.label'));

    Object.keys(SUPPORTED_LOCALES).forEach((code) => {
      const option = document.createElement('option');
      option.value       = code;
      option.textContent = this.t(`langSwitcher.${code}`);
      if (code === _locale) option.selected = true;
      select.appendChild(option);
    });

    select.addEventListener('change', async (e) => {
      await this.setLocale(e.target.value);
    });

    wrapper.appendChild(label);
    wrapper.appendChild(select);
    container.appendChild(wrapper);

    // Store a reference so _syncSwitcher can update the selected value
    this._switcherSelect = select;
  },

  /**
   * Synchronise the switcher <select> value with the current locale.
   * Called internally after setLocale().
   * @private
   */
  _syncSwitcher() {
    if (this._switcherSelect) {
      this._switcherSelect.value = _locale;
      // Update option labels (they may have been created with the previous locale)
      Array.from(this._switcherSelect.options).forEach((opt) => {
        opt.textContent = this.t(`langSwitcher.${opt.value}`);
      });
    }
  },

  /**
   * Returns the list of supported locale codes.
   * @returns {string[]}
   */
  getSupportedLocales() {
    return Object.keys(SUPPORTED_LOCALES);
  },

  /**
   * Resolve a localized error message for a contract error code.
   *
   * Looks up `errors.<code>.message` in the active locale. Falls back to
   * `errors.<code>.message` in the default locale, then to
   * `errors.unknown.message`, and finally to the provided fallback string.
   *
   * @param {string} code  Contract error code (e.g. "SIGNATURE_FAILED")
   * @param {string} [fallback]  Text to return if no translation exists
   * @returns {string}
   */
  tError(code, fallback) {
    if (!code) return fallback || this.t('errors.unknown.message');

    const key = `errors.${code}.message`;
    const value = resolvePath(_messages, key);
    if (typeof value === 'string') return value;

    // Fall back to the default locale's messages if the active one is missing it
    if (_locale !== DEFAULT_LOCALE && _defaultMessages) {
      const fallbackValue = resolvePath(_defaultMessages, key);
      if (typeof fallbackValue === 'string') return fallbackValue;
    }

    const unknown = resolvePath(_messages, 'errors.unknown.message');
    if (typeof unknown === 'string') return unknown;

    return fallback || code;
  },

  /**
   * Returns whether a contract error code is marked as retryable in the
   * active locale's translations (`errors.<code>.retryable`).
   *
   * @param {string} code
   * @returns {boolean}
   */
  isErrorRetryable(code) {
    if (!code) return false;
    const value = resolvePath(_messages, `errors.${code}.retryable`);
    if (typeof value === 'boolean') return value;
    if (_defaultMessages) {
      const fallbackValue = resolvePath(_defaultMessages, `errors.${code}.retryable`);
      if (typeof fallbackValue === 'boolean') return fallbackValue;
    }
    return false;
  },
};

// ── CSS for the language switcher ─────────────────────────────────────────────
// Injected once as a <style> tag so consumers don't need a separate stylesheet.

(function injectSwitcherStyles() {
  if (document.getElementById('lf-i18n-styles')) return;

  const style = document.createElement('style');
  style.id = 'lf-i18n-styles';
  style.textContent = `
    .lf-lang-switcher {
      display: inline-flex;
      align-items: center;
      gap: 0.4rem;
      font-size: 0.85rem;
    }
    .lf-lang-label {
      color: inherit;
      font-weight: 500;
    }
    .lf-lang-select {
      appearance: none;
      -webkit-appearance: none;
      background: transparent;
      border: 1px solid currentColor;
      border-radius: 4px;
      color: inherit;
      cursor: pointer;
      font-size: 0.85rem;
      padding: 0.2rem 1.6rem 0.2rem 0.5rem;
      background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6'%3E%3Cpath d='M0 0l5 6 5-6z' fill='%23666'/%3E%3C/svg%3E");
      background-repeat: no-repeat;
      background-position: right 0.5rem center;
      min-height: 32px;
    }
    .lf-lang-select:focus {
      outline: 3px solid rgba(108,71,255,.35);
      outline-offset: 1px;
    }
  `;
  document.head.appendChild(style);
})();

// ── Error message translations ────────────────────────────────────────────────
// Every contract error code must have a translation in all supported locales.
// `errorMessages.js` resolves localized text via `i18n.tError(code)` and
// checks retryability via `i18n.isErrorRetryable(code)`.
//
// The keys below are the canonical set; the locale JSON files under
// ./locales must each contain an `errors` object with the same keys.

/** Canonical contract error codes covered by the translations. */
export const ERROR_CODES = [
  'SIGNATURE_FAILED',
  'INSUFFICIENT_FUNDS',
  'INSUFFICIENT_ALLOWANCE',
  'NETWORK_TIMEOUT',
  'NETWORK_ERROR',
  'RPC_UNAVAILABLE',
  'TRANSACTION_REJECTED',
  'TRANSACTION_REVERTED',
  'TRANSACTION_EXPIRED',
  'NONCE_TOO_LOW',
  'GAS_ESTIMATION_FAILED',
  'INVALID_ADDRESS',
  'INVALID_AMOUNT',
  'CONTRACT_NOT_FOUND',
  'UNAUTHORIZED',
  'RATE_LIMITED',
  'UNKNOWN',
];
