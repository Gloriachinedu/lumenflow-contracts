/**
 * LumenFlow Focus Management Utilities (issue #790)
 *
 * Provides:
 *   - FocusTrap        — traps keyboard focus inside a container (modals / drawers)
 *   - ToastManager     — accessible toast notifications that announce to screen readers
 *   - restoreFocus()   — helper to return focus to a trigger element after a panel closes
 *   - moveFocusTo()    — move focus to the first focusable element inside a container
 *
 * Usage (browser globals – no build step required):
 *
 *   // Trap focus when a modal opens
 *   const trap = LumenFocus.createFocusTrap(document.getElementById('modal'));
 *   trap.activate();
 *
 *   // Release trap and restore focus when modal closes
 *   trap.deactivate();
 *
 *   // Show a toast
 *   LumenFocus.toast.show('Payment executed successfully!', 'success');
 *
 * Compatible with all modern browsers. No dependencies.
 */

(function (root, factory) {
  if (typeof define === 'function' && define.amd) {
    define([], factory);
  } else if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory();
  } else {
    root.LumenFocus = factory();
  }
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // ── Focusable element selector ────────────────────────────────────────────

  var FOCUSABLE =
    'a[href], area[href], input:not([disabled]):not([type="hidden"]), ' +
    'select:not([disabled]), textarea:not([disabled]), ' +
    'button:not([disabled]), iframe, object, embed, ' +
    '[contenteditable], [tabindex]:not([tabindex="-1"])';

  /**
   * Return all focusable descendants of `container` in DOM order.
   *
   * @param {Element} container
   * @returns {Element[]}
   */
  function getFocusable(container) {
    return Array.prototype.slice.call(container.querySelectorAll(FOCUSABLE))
      .filter(function (el) {
        return !el.closest('[hidden]') && !el.closest('[aria-hidden="true"]');
      });
  }

  // ── moveFocusTo ────────────────────────────────────────────────────────────

  /**
   * Move focus to the first focusable element inside `container`, or to
   * `container` itself if it is focusable and `fallbackToContainer` is true.
   *
   * @param {Element} container
   * @param {boolean} [fallbackToContainer=true]
   */
  function moveFocusTo(container, fallbackToContainer) {
    fallbackToContainer = fallbackToContainer !== false;
    var focusable = getFocusable(container);
    if (focusable.length > 0) {
      focusable[0].focus();
    } else if (fallbackToContainer) {
      if (!container.hasAttribute('tabindex')) container.setAttribute('tabindex', '-1');
      container.focus();
    }
  }

  // ── restoreFocus ───────────────────────────────────────────────────────────

  /**
   * Restore focus to `triggerElement` (the element that opened the dialog/drawer).
   * Safe to call even if the element has been removed from the DOM.
   *
   * @param {Element|null} triggerElement
   */
  function restoreFocus(triggerElement) {
    if (triggerElement && typeof triggerElement.focus === 'function') {
      try { triggerElement.focus(); } catch (e) { /* ignore */ }
    }
  }

  // ── FocusTrap ──────────────────────────────────────────────────────────────

  /**
   * Create a focus trap for a given container element.
   * While active:
   *   - Tab / Shift+Tab cycles within the container
   *   - Escape calls the optional `onEscape` callback
   *
   * @param {Element} container   The element to trap focus within
   * @param {object}  [options]
   * @param {Element} [options.initialFocusEl]  Override where focus lands on activate
   * @param {Function} [options.onEscape]       Called when Escape is pressed
   * @returns {{ activate: Function, deactivate: Function, isActive: Function }}
   */
  function createFocusTrap(container, options) {
    options = options || {};
    var _active = false;
    var _previouslyFocused = null;

    function handleKeydown(e) {
      var key = e.key;

      if (key === 'Escape' && typeof options.onEscape === 'function') {
        options.onEscape(e);
        return;
      }

      if (key !== 'Tab') return;

      var focusable = getFocusable(container);
      if (focusable.length === 0) {
        e.preventDefault();
        return;
      }

      var first = focusable[0];
      var last  = focusable[focusable.length - 1];

      if (e.shiftKey) {
        // Shift+Tab — going backwards
        if (document.activeElement === first || !container.contains(document.activeElement)) {
          e.preventDefault();
          last.focus();
        }
      } else {
        // Tab — going forwards
        if (document.activeElement === last || !container.contains(document.activeElement)) {
          e.preventDefault();
          first.focus();
        }
      }
    }

    return {
      /** Activate the trap: store current focus, move into container, attach listener. */
      activate: function () {
        if (_active) return;
        _active = true;
        _previouslyFocused = document.activeElement;

        var initialEl = options.initialFocusEl || null;
        if (initialEl && typeof initialEl.focus === 'function') {
          initialEl.focus();
        } else {
          moveFocusTo(container);
        }

        document.addEventListener('keydown', handleKeydown, true);
      },

      /** Deactivate the trap: remove listener, optionally restore focus. */
      deactivate: function (skipRestoreFocus) {
        if (!_active) return;
        _active = false;
        document.removeEventListener('keydown', handleKeydown, true);

        if (!skipRestoreFocus) {
          restoreFocus(_previouslyFocused);
        }
        _previouslyFocused = null;
      },

      /** @returns {boolean} */
      isActive: function () { return _active; },
    };
  }

  // ── ToastManager ──────────────────────────────────────────────────────────

  /**
   * Manages a single accessible toast region in the page.
   *
   * Toasts are announced to screen readers via a `role="status"` (polite) or
   * `role="alert"` (assertive) live region injected into the DOM on first use.
   * Visual toasts auto-dismiss after a configurable duration.
   *
   * @example
   *   LumenFocus.toast.show('Saved!', 'success');
   *   LumenFocus.toast.show('Failed to connect', 'error');
   */
  var toast = (function () {
    var _container = null;
    var _timeouts  = [];

    function ensureContainer() {
      if (_container) return _container;

      _container = document.createElement('div');
      _container.id = 'lf-toast-region';
      _container.setAttribute('aria-live', 'polite');
      _container.setAttribute('aria-atomic', 'false');
      _container.setAttribute('aria-relevant', 'additions');
      Object.assign(_container.style, {
        position:    'fixed',
        bottom:      '1.5rem',
        right:       '1.5rem',
        zIndex:      '9999',
        display:     'flex',
        flexDirection: 'column',
        gap:         '0.5rem',
        maxWidth:    '24rem',
        width:       'calc(100% - 3rem)',
        pointerEvents: 'none',
      });

      document.body.appendChild(_container);
      return _container;
    }

    function injectStyles() {
      if (document.getElementById('lf-toast-styles')) return;
      var style = document.createElement('style');
      style.id = 'lf-toast-styles';
      style.textContent = [
        '.lf-toast {',
        '  display: flex;',
        '  align-items: flex-start;',
        '  gap: 0.6rem;',
        '  padding: 0.75rem 1rem;',
        '  border-radius: 10px;',
        '  font-size: 0.875rem;',
        '  font-weight: 500;',
        '  box-shadow: 0 4px 20px rgba(0,0,0,0.15);',
        '  pointer-events: all;',
        '  opacity: 0;',
        '  transform: translateY(0.5rem);',
        '  transition: opacity 0.2s ease, transform 0.2s ease;',
        '}',
        '.lf-toast.lf-toast--visible {',
        '  opacity: 1;',
        '  transform: translateY(0);',
        '}',
        '.lf-toast--success { background: #1a9e5c; color: #fff; }',
        '.lf-toast--error   { background: #d93025; color: #fff; }',
        '.lf-toast--info    { background: #1a1a2e; color: #fff; }',
        '.lf-toast__msg     { flex: 1; }',
        '.lf-toast__close {',
        '  background: none;',
        '  border: none;',
        '  color: inherit;',
        '  opacity: 0.8;',
        '  cursor: pointer;',
        '  font-size: 1.1rem;',
        '  line-height: 1;',
        '  padding: 0;',
        '  flex-shrink: 0;',
        '}',
        '.lf-toast__close:hover { opacity: 1; }',
        '.lf-toast__close:focus-visible {',
        '  outline: 2px solid rgba(255,255,255,0.8);',
        '  outline-offset: 2px;',
        '  border-radius: 3px;',
        '}',
      ].join('\n');
      document.head.appendChild(style);
    }

    /**
     * Show a toast notification.
     *
     * @param {string} message
     * @param {'success'|'error'|'info'} [type='info']
     * @param {number} [duration=4000]  ms before auto-dismiss. 0 = persist.
     */
    function show(message, type, duration) {
      type     = type     || 'info';
      duration = duration !== undefined ? duration : 4000;

      if (typeof document === 'undefined') return;

      injectStyles();
      var container = ensureContainer();

      // Assertive announcements for errors; polite for everything else
      container.setAttribute('aria-live', type === 'error' ? 'assertive' : 'polite');

      var el = document.createElement('div');
      el.className = 'lf-toast lf-toast--' + type;
      el.setAttribute('role', type === 'error' ? 'alert' : 'status');

      var msgEl = document.createElement('span');
      msgEl.className = 'lf-toast__msg';
      msgEl.textContent = message;

      var closeBtn = document.createElement('button');
      closeBtn.className = 'lf-toast__close';
      closeBtn.setAttribute('aria-label', 'Dismiss notification');
      closeBtn.textContent = '×';
      closeBtn.addEventListener('click', function () { dismiss(el); });

      el.appendChild(msgEl);
      el.appendChild(closeBtn);
      container.appendChild(el);

      // Trigger CSS transition
      requestAnimationFrame(function () {
        requestAnimationFrame(function () {
          if (el.classList && el.classList.add) {
            el.classList.add('lf-toast--visible');
          }
        });
      });

      if (duration > 0) {
        var tid = setTimeout(function () { dismiss(el); }, duration);
        _timeouts.push(tid);
      }

      return el;
    }

    function dismiss(el) {
      if (!el || !el.parentNode) return;
      if (el.classList && el.classList.remove) {
        el.classList.remove('lf-toast--visible');
      }
      setTimeout(function () {
        if (el.parentNode) el.parentNode.removeChild(el);
      }, 250);
    }

    function dismissAll() {
      _timeouts.forEach(function (id) { clearTimeout(id); });
      _timeouts = [];
      if (_container) {
        var children = _container.children
          ? Array.prototype.slice.call(_container.children)
          : (_container._children ? _container._children.slice() : []);
        children.forEach(dismiss);
      }
    }

    return { show: show, dismiss: dismiss, dismissAll: dismissAll };
  }());

  // ── Public API ─────────────────────────────────────────────────────────────

  return {
    getFocusable:    getFocusable,
    moveFocusTo:     moveFocusTo,
    restoreFocus:    restoreFocus,
    createFocusTrap: createFocusTrap,
    toast:           toast,
  };
}));
