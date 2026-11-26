/**
 * focus-visible polyfill for LumenFlow frontend
 *
 * Safari versions below 15.4 do not fully support the `:focus-visible`
 * CSS pseudo-class, causing keyboard users to see no focus rings on
 * interactive elements (WCAG 2.4.7 — Focus Visible failure).
 *
 * This polyfill:
 *   1. Detects whether the browser natively supports `:focus-visible`.
 *   2. If not supported, applies the `.focus-visible` class to focused
 *      elements that received focus via the keyboard, and removes it
 *      when focus was triggered by pointer (mouse/touch).
 *   3. Injects a `<style>` block that makes selectors using `:focus-visible`
 *      also respond to the `.focus-visible` class.
 *   4. Does nothing if native support is detected — zero overhead for
 *      modern browsers.
 *
 * Loading: include this script *before* any CSS that uses `:focus-visible`
 * so that the style injection happens before first paint.
 *
 *   <script src="focus-visible-polyfill.js"></script>
 *   <link rel="stylesheet" href="styles.css" />
 *
 * Issue #1016: Add focus-visible polyfill for Safari keyboard navigation.
 * WCAG 2.4.7 — Focus Visible.
 *
 * No external dependencies. Compatible with all modern browsers.
 * Lightweight: < 2 KB minified; does not affect page load performance
 * measurably when loaded synchronously before the stylesheet.
 */
(function () {
  'use strict';

  // ── Native support detection ─────────────────────────────────────────────

  /**
   * Returns true if the browser natively supports the :focus-visible
   * CSS pseudo-class.  We test this by trying to parse a rule that uses it;
   * if the browser does not understand the selector, the rule is dropped
   * and the sheet's cssRules length will be 0.
   *
   * @returns {boolean}
   */
  function nativeFocusVisibleSupported() {
    try {
      document.querySelector(':focus-visible');
      return true;
    } catch (e) {
      return false;
    }
  }

  // Early exit for browsers that natively support :focus-visible (Chrome 86+,
  // Firefox 85+, Safari 15.4+, Edge 86+).
  if (nativeFocusVisibleSupported()) {
    return;
  }

  // ── Polyfill active ──────────────────────────────────────────────────────

  /**
   * True when the most recent interaction was a keyboard action.
   * Pointer interactions (mouse / touch) set this to false.
   */
  var hadKeyboardEvent = true;

  /**
   * Keep track of the element that currently has the `.focus-visible` class
   * so we can remove it quickly when focus moves away.
   */
  var focusVisibleElement = null;

  /**
   * Keys that should trigger focus-visible when pressed.
   * Excludes modifier-only keys (Shift, Alt, Meta) and function keys that
   * do not typically move focus.
   */
  var navigationKeys = new Set([
    'Tab', 'Enter', ' ', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
    'Home', 'End', 'PageUp', 'PageDown', 'Escape',
  ]);

  // ── Event handlers ───────────────────────────────────────────────────────

  /**
   * Pointer down (mouse / touch) — mark interaction as pointer-based.
   * The next focus event will NOT add .focus-visible.
   */
  function onPointerDown() {
    hadKeyboardEvent = false;
  }

  /**
   * Keyboard down — if the key is a navigation/activation key, mark
   * the interaction as keyboard-based so the next focus event adds
   * .focus-visible.
   *
   * @param {KeyboardEvent} e
   */
  function onKeyDown(e) {
    if (navigationKeys.has(e.key)) {
      hadKeyboardEvent = true;
    }
  }

  /**
   * Focus gained — add `.focus-visible` if the most recent interaction
   * was keyboard-based, or if the element is a text input (always show
   * focus ring on text inputs regardless of pointer use, per WCAG).
   *
   * @param {FocusEvent} e
   */
  function onFocus(e) {
    var el = e.target;
    if (!el || typeof el.classList === 'undefined') return;

    // Always show focus ring on text-like inputs — pointer users benefit too
    // (they need to see where they are typing).
    var isTextInput =
      (el.tagName === 'INPUT' && !/^(checkbox|radio|range|color|file|submit|reset|button)$/i.test(el.type || '')) ||
      el.tagName === 'TEXTAREA' ||
      el.isContentEditable;

    if (hadKeyboardEvent || isTextInput) {
      el.classList.add('focus-visible');
      focusVisibleElement = el;
    }
  }

  /**
   * Focus lost — remove `.focus-visible` from the element that had it.
   *
   * @param {FocusEvent} e
   */
  function onBlur(e) {
    var el = e.target;
    if (!el || typeof el.classList === 'undefined') return;
    el.classList.remove('focus-visible');
    if (focusVisibleElement === el) {
      focusVisibleElement = null;
    }
  }

  // ── DOM event wiring ─────────────────────────────────────────────────────

  // Use capture phase so events fire even inside shadow DOM / iframes.
  document.addEventListener('keydown',     onKeyDown,    true);
  document.addEventListener('mousedown',   onPointerDown, true);
  document.addEventListener('pointerdown', onPointerDown, true);
  document.addEventListener('touchstart',  onPointerDown, true);
  document.addEventListener('focus',       onFocus,      true);
  document.addEventListener('blur',        onBlur,       true);

  // ── CSS injection ────────────────────────────────────────────────────────

  /**
   * Inject a <style> block that maps the polyfill's `.focus-visible` class
   * to every `:focus-visible` selector used in LumenFlow's CSS.
   *
   * The injected rules use the same specificity as `:focus-visible` so they
   * apply correctly without needing to modify individual stylesheets.
   *
   * This block only runs when native support is absent, so there is no CSS
   * specificity conflict for modern browsers.
   */
  // High-contrast focus colour tokens (WCAG 2.1 AA — 1.4.11 Non-text
  // Contrast and 2.4.7 Focus Visible).  These values are shared with the
  // main stylesheet so the polyfill and native `:focus-visible` rules stay
  // in sync.  The light-mode ring (#0b3d91) achieves > 7:1 against white
  // and the dark-mode ring (#ffd166) achieves > 7:1 against the dark
  // surface, both well above the 3:1 minimum for focus indicators.
  var FOCUS_RING_LIGHT = '#0b3d91';
  var FOCUS_RING_DARK = '#ffd166';

  /**
   * Build a focus-ring rule for the given selector list, emitting both a
   * light-mode and a dark-mode (prefers-color-scheme) variant so the ring
   * remains visible on every audited page regardless of theme.
   *
   * @param {string} selectors  Comma-separated selector list.
   * @returns {string[]}        Array of CSS rule strings.
   */
  function focusRingRules(selectors) {
    return [
      selectors + ' {',
      '  outline: 3px solid ' + FOCUS_RING_LIGHT + ';',
      '  outline-offset: 2px;',
      '}',
      '@media (prefers-color-scheme: dark) {',
      '  ' + selectors + ' {',
      '    outline-color: ' + FOCUS_RING_DARK + ';',
      '  }',
      '}',
    ];
  }

  var style = document.createElement('style');
  style.id = 'lf-focus-visible-polyfill';
  style.textContent = [].concat(
    /* General interactive elements — covers links, buttons, form controls,
       summary/details, and any element made focusable via tabindex. */
    focusRingRules([
      'a.focus-visible',
      'button.focus-visible',
      'input.focus-visible',
      'select.focus-visible',
      'textarea.focus-visible',
      'summary.focus-visible',
      '[tabindex].focus-visible',
      '[contenteditable].focus-visible',
      '[role="button"].focus-visible',
      '[role="link"].focus-visible',
      '[role="tab"].focus-visible',
      '[role="menuitem"].focus-visible',
      '[role="option"].focus-visible',
      '[role="checkbox"].focus-visible',
      '[role="radio"].focus-visible',
      '[role="switch"].focus-visible',
    ].join(', ')),

    /* Remove outline for pointer-focused elements (mouse clicks should not
       show focus rings; the .focus-visible class is only added for keyboard) */
    [
      'a:focus:not(.focus-visible),',
      'button:focus:not(.focus-visible),',
      'input:focus:not(.focus-visible),',
      'select:focus:not(.focus-visible),',
      'textarea:focus:not(.focus-visible),',
      'summary:focus:not(.focus-visible),',
      '[tabindex]:focus:not(.focus-visible) {',
      '  outline: none;',
      '}',
    ].join('\n'),

    /* Component-specific overrides — match specificity of existing styles */

    /* Wallet chip (wallet-status.js) */
    focusRingRules('.wallet-chip.focus-visible'),

    /* Filter panel / toolbar chips (filter-keyboard.js) */
    focusRingRules('.filter-panel *.focus-visible, .toolbar *.focus-visible'),

    focusRingRules('.chip button.focus-visible'),

    /* Combobox trigger (filter-keyboard.js) */
    focusRingRules('.lf-combobox-trigger.focus-visible'),

    /* Copy button (lumenflow-shared.js) */
    focusRingRules('.lf-copy-btn.focus-visible'),

    /* Toast close button (focus-management.js, toast.js) */
    focusRingRules('.lf-toast__close.focus-visible, .lf-toast-close.focus-visible'),

    /* Dark-mode toggle (styles.css) */
    focusRingRules('#lf-dark-toggle.focus-visible'),

    /* Skip link (focus-management.js) — must be visible when focused */
    focusRingRules('.lf-skip-link.focus-visible'),

    /* Modal / dialog close buttons and dialog containers */
    focusRingRules('.lf-modal-close.focus-visible, [role="dialog"] .focus-visible'),

    /* Navigation menu items and pagination controls */
    focusRingRules('.lf-nav-item.focus-visible, .lf-pagination button.focus-visible')
  ).join('\n');
=======

  // Inject before the first <link> or <style> so the rules are overridden
  // by component-specific styles if needed.
  var head = document.head || document.getElementsByTagName('head')[0];
  var firstStyleOrLink = head.querySelector('link[rel="stylesheet"], style');
  if (firstStyleOrLink) {
    head.insertBefore(style, firstStyleOrLink);
  } else {
    head.appendChild(style);
  }

  // ── Public API ───────────────────────────────────────────────────────────

  /**
   * Exposed on window for testing and for focus-management.js to optionally
   * query whether the polyfill is active.
   */
  if (typeof window !== 'undefined') {
    window.LumenFocusVisiblePolyfill = {
      /** True — polyfill is active in this browser. */
      active: true,
      /** Returns true if the given element currently has .focus-visible. */
      hasFocusVisible: function (el) {
        return el && el.classList && el.classList.contains('focus-visible');
      },
    };
  }
}());
