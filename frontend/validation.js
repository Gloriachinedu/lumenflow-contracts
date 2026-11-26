/**
 * validation.js
 * Shared input validators for LumenFlow frontend forms.
 * Every validator returns an error message string, or '' when the value is
 * valid, so pages can render the result directly as an inline field error.
 */

export const ORDER_ID_MAX_LENGTH = 64;

// StrKey format check: 1-char type prefix + 55 base32 chars (A-Z, 2-7).
// G = account/public key, C = contract. The checksum is verified by the
// SDK/contract; the frontend only enforces shape and length.
const STELLAR_KEY_BODY = /^[A-Z2-7]{55}$/;

export function isValidStellarKey(value, prefixes = ['G']) {
  if (typeof value !== 'string' || value.length !== 56) return false;
  if (!prefixes.includes(value[0])) return false;
  return STELLAR_KEY_BODY.test(value.slice(1));
}

export function validateOrderId(value, label = 'Order ID') {
  const v = (value || '').trim();
  if (!v) return `${label} is required.`;
  if (v.length > ORDER_ID_MAX_LENGTH) {
    return `${label} must be ${ORDER_ID_MAX_LENGTH} characters or fewer.`;
  }
  return '';
}

export function validateAmount(value, { label = 'Amount', integer = false, allowZero = false, required = true } = {}) {
  const raw = (value == null ? '' : String(value)).trim();
  if (!raw) return required ? `${label} is required.` : '';
  const num = Number(raw);
  if (!Number.isFinite(num)) return `${label} must be a number.`;
  if (integer && !Number.isInteger(num)) return `${label} must be a whole number.`;
  if (allowZero ? num < 0 : num <= 0) {
    return allowZero ? `${label} cannot be negative.` : `${label} must be greater than zero.`;
  }
  return '';
}

export function validateAddress(value, { label = 'Address', prefixes = ['G'], required = true } = {}) {
  const v = (value || '').trim();
  if (!v) return required ? `${label} is required.` : '';
  if (!isValidStellarKey(v, prefixes)) {
    return `${label} must be a valid Stellar address (starts with ${prefixes.join(' or ')}, 56 characters).`;
  }
  return '';
}

/**
 * form-autosave.js
 * Shared auto-save helpers for LumenFlow payment forms.
 *
 * Form state is persisted to sessionStorage on every `input` event and
 * restored on page load behind a "Restore previous session?" prompt, so an
 * accidental navigation does not force the user to re-enter everything.
 *
 * Safety: only allow-listed, non-sensitive fields are ever written to
 * storage. A deny-list of sensitive field names (private keys, seed phrases,
 * secrets, ...) is always enforced, even if a caller allow-lists them.
 *
 * Exposed both as an ES module and as a browser global (`window.FormAutosave`)
 * so plain <script> pages can use it without a bundler.
 */

export const AUTOSAVE_KEY_PREFIX = 'lumenflow:autosave:';

// Field names / ids that must never be persisted, matched case-insensitively
// against the field's name, id and autocomplete attributes.
const SENSITIVE_PATTERNS = [
  /private[\s_-]*key/i,
  /secret/i,
  /seed/i,
  /mnemonic/i,
  /passphrase/i,
  /password/i,
  /recovery/i,
  /signature/i,
  /signed[\s_-]*xdr/i,
  /xdr/i,
];

// Input types that are never persisted regardless of name.
const SENSITIVE_TYPES = new Set(['password', 'hidden', 'file']);

export function isSensitiveField(field) {
  if (!field) return true;
  const type = (field.type || '').toLowerCase();
  if (SENSITIVE_TYPES.has(type)) return true;
  const haystack = [field.name, field.id, field.getAttribute && field.getAttribute('autocomplete')]
    .filter(Boolean)
    .join(' ');
  if (!haystack) return false;
  return SENSITIVE_PATTERNS.some((re) => re.test(haystack));
}

function storageKey(formId) {
  return `${AUTOSAVE_KEY_PREFIX}${formId}`;
}

function getStorage() {
  try {
    return typeof window !== 'undefined' ? window.sessionStorage : null;
  } catch (err) {
    // Storage can throw in private mode / when disabled.
    return null;
  }
}

function readState(formId) {
  const storage = getStorage();
  if (!storage) return null;
  try {
    const raw = storage.getItem(storageKey(formId));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch (err) {
    return null;
  }
}

function writeState(formId, state) {
  const storage = getStorage();
  if (!storage) return;
  try {
    storage.setItem(storageKey(formId), JSON.stringify(state));
  } catch (err) {
    // Quota exceeded or storage unavailable: auto-save is best-effort.
  }
}

/**
 * Collect the persistable values of a form.
 * @param {HTMLFormElement} form
 * @param {string[]} [allowList] optional list of field names to persist.
 *   When omitted, every non-sensitive field is persisted.
 */
export function serializeForm(form, allowList) {
  const state = {};
  if (!form || !form.elements) return state;
  const allowed = Array.isArray(allowList) && allowList.length ? new Set(allowList) : null;
  Array.from(form.elements).forEach((field) => {
    if (!field || !field.name) return;
    if (allowed && !allowed.has(field.name)) return;
    if (isSensitiveField(field)) return;
    const type = (field.type || '').toLowerCase();
    if (type === 'checkbox' || type === 'radio') {
      state[field.name] = field.checked;
    } else if (type !== 'submit' && type !== 'button' && type !== 'reset') {
      state[field.name] = field.value;
    }
  });
  return state;
}

/**
 * Apply a previously saved state to a form.
 * @param {HTMLFormElement} form
 * @param {Object} state
 */
export function restoreForm(form, state) {
  if (!form || !form.elements || !state) return;
  Array.from(form.elements).forEach((field) => {
    if (!field || !field.name) return;
    if (isSensitiveField(field)) return;
    if (!Object.prototype.hasOwnProperty.call(state, field.name)) return;
    const type = (field.type || '').toLowerCase();
    if (type === 'checkbox' || type === 'radio') {
      field.checked = Boolean(state[field.name]);
    } else if (type !== 'submit' && type !== 'button' && type !== 'reset') {
      field.value = state[field.name];
    }
    field.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

/**
 * Clear the saved state for a form.
 * @param {string} formId
 */
export function clearSavedState(formId) {
  const storage = getStorage();
  if (!storage) return;
  try {
    storage.removeItem(storageKey(formId));
  } catch (err) {
    // ignore
  }
}

/**
 * Attach auto-save behaviour to a form.
 *
 * @param {HTMLFormElement|string} formOrId form element or its id.
 * @param {Object} [options]
 * @param {string[]} [options.allowList] field names to persist (default: all non-sensitive).
 * @param {boolean} [options.promptOnRestore=true] ask before restoring saved state.
 * @param {string} [options.promptMessage] custom confirm message.
 * @param {Function} [options.confirm] injectable confirm fn (for tests).
 * @returns {{ clear: Function, restore: Function, save: Function }|null}
 */
export function attachAutosave(formOrId, options = {}) {
  const form = typeof formOrId === 'string'
    ? (typeof document !== 'undefined' ? document.getElementById(formOrId) : null)
    : formOrId;
  if (!form) return null;

  const formId = form.id || options.formId;
  if (!formId) return null;

  const {
    allowList,
    promptOnRestore = true,
    promptMessage = 'Restore previous session?',
    confirm: confirmFn,
  } = options;

  const save = () => writeState(formId, serializeForm(form, allowList));

  form.addEventListener('input', save);
  form.addEventListener('change', save);

  const saved = readState(formId);
  if (saved) {
    const ask = confirmFn || (typeof window !== 'undefined' ? window.confirm.bind(window) : () => false);
    if (!promptOnRestore || ask(promptMessage)) {
      restoreForm(form, saved);
    } else {
      clearSavedState(formId);
    }
  }

  // Clear on successful submit. Pages that submit via fetch can call
  // `clear()` themselves once the request succeeds.
  form.addEventListener('submit', () => clearSavedState(formId));

  return {
    save,
    restore: () => {
      const state = readState(formId);
      if (state) restoreForm(form, state);
    },
    clear: () => clearSavedState(formId),
  };
}

const FormAutosave = {
  AUTOSAVE_KEY_PREFIX,
  isSensitiveField,
  serializeForm,
  restoreForm,
  clearSavedState,
  attachAutosave,
};

if (typeof window !== 'undefined') {
  window.FormAutosave = FormAutosave;
}

export default FormAutosave;
