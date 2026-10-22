/**
 * focus-management.js
 * Focus trapping and restoration utilities for modal dialogs.
 *
 * Usage:
 *   import { trapFocus, releaseFocus, focusFirstElement } from './focus-management.js';
 *
 *   // When modal opens:
 *   trapFocus(modalElement, previouslyFocusedElement);
 *
 *   // When modal closes:
 *   releaseFocus(previouslyFocusedElement);
 */

// CSS selector for all focusable/tabbable elements
const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
  '[contenteditable="true"]',
].join(', ');

/**
 * Returns all focusable elements within a container, in DOM order.
 * @param {HTMLElement} container - The container element to search within.
 * @returns {HTMLElement[]}
 */
export function getFocusableElements(container) {
  return Array.from(container.querySelectorAll(FOCUSABLE_SELECTOR)).filter(
    (el) => {
      // Exclude elements that are not visible (display:none, visibility:hidden)
      if (el.offsetParent === null && el.tagName !== 'INPUT' && el.tagName !== 'BUTTON') {
        return false;
      }
      // Exclude elements with display:none via offsetParent for inputs/buttons too
      if (el.getClientRects().length === 0) {
        return false;
      }
      return true;
    },
  );
}

/**
 * Moves focus to the first focusable element inside a container.
 * @param {HTMLElement} container
 */
export function focusFirstElement(container) {
  const focusable = getFocusableElements(container);
  if (focusable.length > 0) {
    focusable[0].focus();
  } else {
    // Container itself should be focusable as a fallback
    container.setAttribute('tabindex', '-1');
    container.focus();
  }
}

/**
 * The active focus trap state.
 * @type {{ container: HTMLElement, handler: (e: KeyboardEvent) => void } | null}
 */
let activeTrap = null;

/**
 * Traps keyboard focus within a container element. Tab and Shift+Tab cycle
 * only through focusable elements inside the container.
 *
 * @param {HTMLElement} container - The element to trap focus within.
 * @param {HTMLElement|null} triggerElement - The element that had focus before
 *   opening the modal. Focus will be restored to it on releaseFocus().
 */
export function trapFocus(container, triggerElement) {
  // Release any existing trap first
  if (activeTrap) {
    releaseFocus();
  }

  // Set up dialog semantics
  container.setAttribute('role', 'dialog');
  container.setAttribute('aria-modal', 'true');

  // Store trigger for focus restoration
  container._lfTriggerElement = triggerElement || document.activeElement;

  // Focus the first focusable element
  focusFirstElement(container);

  /**
   * Keydown handler that intercepts Tab / Shift+Tab to keep focus cycling
   * within the container.
   */
  const handler = (e) => {
    if (e.key !== 'Tab') return;

    const focusable = getFocusableElements(container);
    if (focusable.length === 0) {
      e.preventDefault();
      return;
    }

    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement;

    if (e.shiftKey) {
      // Shift+Tab: if on first element, wrap to last
      if (active === first || active === container || !container.contains(active)) {
        e.preventDefault();
        last.focus();
      }
    } else {
      // Tab: if on last element, wrap to first
      if (active === last || !container.contains(active)) {
        e.preventDefault();
        first.focus();
      }
    }
  };

  // Attach the handler to the container so it captures keydown events
  container.addEventListener('keydown', handler);
  activeTrap = { container, handler };
}

/**
 * Releases the active focus trap and restores focus to the trigger element.
 * Optionally closes the dialog by emitting Escape handling.
 *
 * @param {HTMLElement|null} triggerElement - Override the element to restore
 *   focus to. If not provided, uses the stored trigger element.
 */
export function releaseFocus(triggerElement) {
  if (!activeTrap) return;

  const { container, handler } = activeTrap;
  container.removeEventListener('keydown', handler);

  // Remove dialog semantics
  container.removeAttribute('role');
  container.removeAttribute('aria-modal');

  // Restore focus
  const restoreTo = triggerElement || container._lfTriggerElement;
  if (restoreTo && typeof restoreTo.focus === 'function') {
    restoreTo.focus();
  }
  delete container._lfTriggerElement;

  activeTrap = null;
}

/**
 * Sets up Escape key handling for a modal dialog. When Escape is pressed,
 * the provided callback is called (typically to close the dialog).
 *
 * @param {HTMLElement} container - The dialog container.
 * @param {() => void} onEscape - Callback to run when Escape is pressed.
 */
export function setupEscapeHandler(container, onEscape) {
  const handler = (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onEscape();
    }
  };
  container.addEventListener('keydown', handler);
  return () => container.removeEventListener('keydown', handler);
}
