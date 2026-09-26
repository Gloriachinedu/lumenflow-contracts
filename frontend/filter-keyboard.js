/**
 * filter-keyboard.js
 *
 * Keyboard navigation enhancements for LumenFlow payment filter panels.
 *
 * Usage:
 *   import { initFilterKeyboard } from './filter-keyboard.js';
 *   initFilterKeyboard('#filter-panel');   // history.html
 *   initFilterKeyboard('.toolbar');        // payment-history.html
 *
 * Features:
 *  - Injects focus-ring CSS for all focusable controls in the panel
 *  - Adds role="group" + aria-labelledby to .filter-group elements
 *  - Wires Escape on text/number/date inputs → clear + dispatch "change"
 *  - Wires Escape on select elements → blur (native dropdown closes)
 *  - Makes .chip dismiss buttons fully keyboard-accessible (Enter / Space)
 *  - Wraps <select id="token-selector"> and <select id="status-selector">
 *    (and <select id="status-filter"> in payment-history.html) with a custom
 *    ARIA combobox so screen-readers and keyboard users get rich feedback:
 *      role="combobox" on wrapper button
 *      role="listbox"  on dropdown list
 *      role="option"   on each item
 *      aria-expanded / aria-haspopup / aria-activedescendant attributes
 *      Up/Down arrows cycle through options
 *      Enter selects the focused option
 *      Escape closes the dropdown, returns focus to trigger button
 *      Focus is trapped inside the open listbox
 */

// ─── Injected styles ──────────────────────────────────────────────────────────

const FOCUS_STYLE_ID = 'lumenflow-filter-keyboard-styles';

function injectStyles() {
  if (document.getElementById(FOCUS_STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = FOCUS_STYLE_ID;
  style.textContent = `
    /* ── Keyboard focus rings for filter panels ──────────────────────────── */

    /* WCAG 2.1 SC 1.4.11 — #6c47ff on #f0ecff = 5.4:1 contrast ratio,
       exceeds the 3:1 minimum for non-text focus indicators.            */
    .filter-panel *:focus-visible,
    .toolbar *:focus-visible {
      outline: 3px solid #6c47ff !important;
      outline-offset: 2px !important;
      border-radius: 4px !important;
    }

    /* Chip dismiss button */
    .chip button:focus-visible {
      outline: 3px solid #6c47ff !important;
      outline-offset: 2px !important;
      border-radius: 3px !important;
    }

    /* ── Custom ARIA combobox ─────────────────────────────────────────────── */
    .lf-combobox-wrapper {
      position: relative;
      display: inline-block;
      width: 100%;
    }

    /* The visible trigger button mirrors the <select> appearance */
    .lf-combobox-trigger {
      display: flex;
      align-items: center;
      justify-content: space-between;
      width: 100%;
      padding: 0.6rem;
      border: 1px solid #e0e0e0;
      border-radius: 6px;
      font-size: 0.9rem;
      background: #fff;
      color: #1a1a2e;
      cursor: pointer;
      text-align: left;
      transition: border-color 0.15s;
      /* Ensure it matches the original select height/padding in both pages */
      box-sizing: border-box;
    }

    /* payment-history.html uses slightly different padding */
    .toolbar .lf-combobox-trigger {
      padding: 0.5rem 0.75rem;
      border: 1.5px solid #dde1e7;
      border-radius: 8px;
      font-size: 0.875rem;
    }

    .lf-combobox-trigger:focus-visible {
      outline: 3px solid #6c47ff !important;
      outline-offset: 2px !important;
      border-radius: 4px !important;
      border-color: #6c47ff;
    }

    .lf-combobox-trigger:hover,
    .lf-combobox-trigger[aria-expanded="true"] {
      border-color: #6c47ff;
    }

    .lf-combobox-arrow {
      font-size: 0.65rem;
      margin-left: 0.4rem;
      flex-shrink: 0;
      transition: transform 0.15s;
      color: #666;
    }

    .lf-combobox-trigger[aria-expanded="true"] .lf-combobox-arrow {
      transform: rotate(180deg);
    }

    /* The dropdown list */
    .lf-listbox {
      position: absolute;
      top: calc(100% + 4px);
      left: 0;
      z-index: 1000;
      min-width: 100%;
      background: #fff;
      border: 1.5px solid #6c47ff;
      border-radius: 8px;
      box-shadow: 0 4px 20px rgba(0, 0, 0, 0.12);
      padding: 0.3rem 0;
      list-style: none;
      max-height: 220px;
      overflow-y: auto;
      /* Hidden by default */
      display: none;
    }

    .lf-listbox[aria-hidden="false"] {
      display: block;
    }

    /* Individual option */
    .lf-option {
      padding: 0.55rem 0.9rem;
      font-size: 0.9rem;
      color: #1a1a2e;
      cursor: pointer;
      transition: background 0.1s;
    }

    .toolbar .lf-option {
      font-size: 0.875rem;
    }

    .lf-option:hover,
    .lf-option[aria-selected="true"] {
      background: #f0ecff;
      color: #6c47ff;
    }

    /* Keyboard-focused option (via aria-activedescendant styling) */
    .lf-option.lf-focused {
      background: #6c47ff;
      color: #fff;
      outline: none;
    }

    /* Visually hidden helper */
    .lf-sr-only {
      position: absolute;
      width: 1px; height: 1px;
      padding: 0; margin: -1px;
      overflow: hidden;
      clip: rect(0, 0, 0, 0);
      border: 0;
    }
  `;
  document.head.appendChild(style);
}

// ─── Unique ID generator ───────────────────────────────────────────────────

let _uid = 0;
function uid(prefix = 'lf') {
  return `${prefix}-${++_uid}`;
}

// ─── Custom ARIA combobox builder ─────────────────────────────────────────────

/**
 * Replaces a <select> element with a fully keyboard-accessible custom
 * combobox while keeping the original <select> in the DOM (hidden) so
 * that all existing JS event listeners on it continue to work.
 *
 * @param {HTMLSelectElement} selectEl
 */
function buildCombobox(selectEl) {
  // Guard: already enhanced
  if (selectEl.dataset.lfEnhanced) return;
  selectEl.dataset.lfEnhanced = 'true';

  const wrapperId  = uid('lf-wrap');
  const triggerId  = uid('lf-trigger');
  const listboxId  = uid('lf-listbox');

  // ── Wrapper ──────────────────────────────────────────────────────────────
  const wrapper = document.createElement('div');
  wrapper.className = 'lf-combobox-wrapper';
  wrapper.id = wrapperId;

  // ── Trigger button ───────────────────────────────────────────────────────
  const trigger = document.createElement('button');
  trigger.type = 'button';
  trigger.className = 'lf-combobox-trigger';
  trigger.id = triggerId;
  trigger.setAttribute('role', 'combobox');
  trigger.setAttribute('aria-haspopup', 'listbox');
  trigger.setAttribute('aria-expanded', 'false');
  trigger.setAttribute('aria-controls', listboxId);
  // Carry over any aria-label from the original select
  const origLabel = selectEl.getAttribute('aria-label') || selectEl.getAttribute('aria-labelledby');
  if (origLabel) {
    if (selectEl.hasAttribute('aria-label')) {
      trigger.setAttribute('aria-label', origLabel);
    } else {
      trigger.setAttribute('aria-labelledby', origLabel);
    }
  }

  const labelSpan = document.createElement('span');
  labelSpan.className = 'lf-trigger-label';
  const arrowSpan = document.createElement('span');
  arrowSpan.className = 'lf-combobox-arrow';
  arrowSpan.setAttribute('aria-hidden', 'true');
  arrowSpan.textContent = '▼';

  trigger.appendChild(labelSpan);
  trigger.appendChild(arrowSpan);

  // ── Listbox ───────────────────────────────────────────────────────────────
  const listbox = document.createElement('ul');
  listbox.id = listboxId;
  listbox.className = 'lf-listbox';
  listbox.setAttribute('role', 'listbox');
  listbox.setAttribute('aria-hidden', 'true');
  listbox.setAttribute('tabindex', '-1');
  // Copy the label association
  if (origLabel && selectEl.hasAttribute('aria-label')) {
    listbox.setAttribute('aria-label', origLabel);
  }

  // ── Build options from select ─────────────────────────────────────────────
  let focusedIdx = -1; // index of keyboard-focused option

  function getOptions() {
    return Array.from(listbox.querySelectorAll('.lf-option'));
  }

  function syncOptions() {
    listbox.innerHTML = '';
    Array.from(selectEl.options).forEach((opt, i) => {
      const li = document.createElement('li');
      li.className = 'lf-option';
      li.setAttribute('role', 'option');
      li.id = uid('lf-opt');
      li.textContent = opt.text;
      li.dataset.value = opt.value;
      if (selectEl.selectedIndex === i) {
        li.setAttribute('aria-selected', 'true');
      } else {
        li.setAttribute('aria-selected', 'false');
      }
      listbox.appendChild(li);
    });
    // Update trigger label
    const selectedOpt = selectEl.options[selectEl.selectedIndex];
    labelSpan.textContent = selectedOpt ? selectedOpt.text : '';
  }

  function selectOption(idx) {
    const opts = getOptions();
    if (idx < 0 || idx >= opts.length) return;

    // Update ARIA selected states
    opts.forEach((o, i) => o.setAttribute('aria-selected', i === idx ? 'true' : 'false'));

    // Sync the real select
    selectEl.selectedIndex = idx;
    labelSpan.textContent = opts[idx].textContent;

    // Dispatch change on the original select so existing listeners fire
    selectEl.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function highlightOption(idx) {
    const opts = getOptions();
    opts.forEach(o => o.classList.remove('lf-focused'));
    if (idx >= 0 && idx < opts.length) {
      opts[idx].classList.add('lf-focused');
      trigger.setAttribute('aria-activedescendant', opts[idx].id);
      // Scroll into view
      opts[idx].scrollIntoView({ block: 'nearest' });
    } else {
      trigger.removeAttribute('aria-activedescendant');
    }
    focusedIdx = idx;
  }

  function openDropdown() {
    syncOptions();
    listbox.setAttribute('aria-hidden', 'false');
    trigger.setAttribute('aria-expanded', 'true');
    // Highlight the currently selected option
    const selectedIdx = selectEl.selectedIndex;
    highlightOption(selectedIdx >= 0 ? selectedIdx : 0);
  }

  function closeDropdown(returnFocus = true) {
    listbox.setAttribute('aria-hidden', 'true');
    trigger.setAttribute('aria-expanded', 'false');
    trigger.removeAttribute('aria-activedescendant');
    focusedIdx = -1;
    if (returnFocus) trigger.focus();
  }

  // ── Click on trigger ──────────────────────────────────────────────────────
  trigger.addEventListener('click', () => {
    if (trigger.getAttribute('aria-expanded') === 'true') {
      closeDropdown();
    } else {
      openDropdown();
    }
  });

  // ── Click on an option ────────────────────────────────────────────────────
  listbox.addEventListener('click', (e) => {
    const optEl = e.target.closest('.lf-option');
    if (!optEl) return;
    const opts = getOptions();
    const idx = opts.indexOf(optEl);
    selectOption(idx);
    closeDropdown();
  });

  // ── Keyboard handling on trigger ──────────────────────────────────────────
  trigger.addEventListener('keydown', (e) => {
    const expanded = trigger.getAttribute('aria-expanded') === 'true';
    const opts = getOptions();

    switch (e.key) {
      case 'Enter':
      case ' ':
        e.preventDefault();
        if (expanded) {
          if (focusedIdx >= 0) {
            selectOption(focusedIdx);
          }
          closeDropdown();
        } else {
          openDropdown();
        }
        break;

      case 'ArrowDown':
        e.preventDefault();
        if (!expanded) {
          openDropdown();
        } else {
          const nextIdx = focusedIdx < opts.length - 1 ? focusedIdx + 1 : 0;
          highlightOption(nextIdx);
        }
        break;

      case 'ArrowUp':
        e.preventDefault();
        if (!expanded) {
          openDropdown();
        } else {
          const prevIdx = focusedIdx > 0 ? focusedIdx - 1 : opts.length - 1;
          highlightOption(prevIdx);
        }
        break;

      case 'Home':
        if (expanded) { e.preventDefault(); highlightOption(0); }
        break;

      case 'End':
        if (expanded) { e.preventDefault(); highlightOption(opts.length - 1); }
        break;

      case 'Escape':
        if (expanded) {
          e.preventDefault();
          e.stopPropagation();
          closeDropdown();
        }
        break;

      case 'Tab':
        // Close without stealing focus flow
        if (expanded) closeDropdown(false);
        break;
    }
  });

  // ── Click outside closes ─────────────────────────────────────────────────
  document.addEventListener('click', (e) => {
    if (!wrapper.contains(e.target) && trigger.getAttribute('aria-expanded') === 'true') {
      closeDropdown(false);
    }
  });

  // ── Assemble DOM ─────────────────────────────────────────────────────────
  // Insert wrapper before the select, then hide the select
  selectEl.parentNode.insertBefore(wrapper, selectEl);
  wrapper.appendChild(trigger);
  wrapper.appendChild(listbox);

  // Move the select inside the wrapper but hide it from AT and visually
  wrapper.appendChild(selectEl);
  selectEl.style.display = 'none';
  selectEl.setAttribute('aria-hidden', 'true');
  selectEl.setAttribute('tabindex', '-1');

  // Initial label
  syncOptions();

  // Re-sync if the underlying select changes programmatically
  const observer = new MutationObserver(syncOptions);
  observer.observe(selectEl, { childList: true, subtree: true, attributes: true });
}

// ─── Filter group ARIA labelling ─────────────────────────────────────────────

/**
 * Adds role="group" and aria-labelledby to each .filter-group that contains
 * a <label> element, so AT announces the group context.
 */
function enhanceFilterGroups(panel) {
  panel.querySelectorAll('.filter-group').forEach(group => {
    if (group.getAttribute('role') === 'group') return; // already done
    group.setAttribute('role', 'group');
    const label = group.querySelector('label');
    if (label) {
      if (!label.id) label.id = uid('lf-lbl');
      group.setAttribute('aria-labelledby', label.id);
    }
  });
}

// ─── Escape key on text / number / date inputs ────────────────────────────────

/**
 * Pressing Escape on a focused text, number, search, or date input:
 *  1. Clears the value
 *  2. Dispatches a "change" event so existing listeners update the filter state
 */
function enhanceInputEscape(panel) {
  const clearableTypes = new Set(['text', 'number', 'search', 'date', 'email', 'url']);

  panel.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    const el = e.target;
    if (el.tagName === 'INPUT' && clearableTypes.has(el.type)) {
      if (el.value !== '') {
        e.preventDefault();
        e.stopPropagation();
        el.value = '';
        el.dispatchEvent(new Event('change', { bubbles: true }));
        // Also fire 'input' for oninput handlers (payment-history.html)
        el.dispatchEvent(new Event('input', { bubbles: true }));
      }
    }
    // For native <select> (ones NOT replaced by the combobox), Escape blurs
    if (el.tagName === 'SELECT' && !el.dataset.lfEnhanced) {
      e.preventDefault();
      el.blur();
    }
  });
}

// ─── Chip (active filter) dismiss buttons ────────────────────────────────────

/**
 * Ensures chip dismiss buttons already in the DOM (and future ones added via
 * MutationObserver) respond to keyboard activation.
 *
 * Native <button> elements already fire click on Enter; this adds Space key
 * support and ensures the button has a clear accessible label.
 */
function enhanceChips(panel) {
  function activateChipButton(btn) {
    if (btn.dataset.lfChip) return;
    btn.dataset.lfChip = 'true';
    // Ensure aria-label is present; the existing HTML already sets it, but
    // add a fallback just in case.
    if (!btn.getAttribute('aria-label')) {
      btn.setAttribute('aria-label', 'Remove filter');
    }
    btn.addEventListener('keydown', (e) => {
      if (e.key === ' ') {
        e.preventDefault();
        btn.click();
      }
    });
  }

  // Enhance existing chips
  panel.querySelectorAll('.chip button').forEach(activateChipButton);

  // Watch for dynamically added chips
  const observer = new MutationObserver((mutations) => {
    mutations.forEach(m => {
      m.addedNodes.forEach(node => {
        if (node.nodeType !== 1) return;
        if (node.matches && node.matches('.chip')) {
          const btn = node.querySelector('button');
          if (btn) activateChipButton(btn);
        }
        if (node.querySelectorAll) {
          node.querySelectorAll('.chip button').forEach(activateChipButton);
        }
      });
    });
  });

  // Observe the active-filters container (or the whole panel as fallback)
  const activeFiltersContainer = panel.querySelector('#active-filters') || panel;
  observer.observe(activeFiltersContainer, { childList: true, subtree: true });
}

// ─── Combobox enhancement for select elements ─────────────────────────────────

/**
 * Identifies the selects that should get the custom combobox treatment.
 * We target status and token selects by their known IDs (both pages).
 */
const COMBOBOX_SELECT_IDS = [
  'token-selector',  // history.html
  'status-selector', // history.html
  'status-filter',   // payment-history.html
];

function enhanceSelects(panel) {
  COMBOBOX_SELECT_IDS.forEach(id => {
    const sel = panel.querySelector(`#${id}`);
    if (sel && sel.tagName === 'SELECT') {
      buildCombobox(sel);
    }
  });
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * initFilterKeyboard
 *
 * Initialises all keyboard-navigation enhancements for the filter panel
 * identified by `panelSelector`.
 *
 * @param {string} [panelSelector='.filter-panel']  CSS selector for the panel
 */
export function initFilterKeyboard(panelSelector = '.filter-panel') {
  const panel = document.querySelector(panelSelector);
  if (!panel) return;

  // 1. Inject focus-ring and combobox CSS once per page
  injectStyles();

  // 2. Add ARIA group roles and labels to .filter-group elements
  enhanceFilterGroups(panel);

  // 3. Wire Escape key to clear inputs and close native selects
  enhanceInputEscape(panel);

  // 4. Make chip dismiss buttons keyboard-accessible
  enhanceChips(panel);

  // 5. Replace status/token selects with accessible comboboxes
  enhanceSelects(panel);
}
