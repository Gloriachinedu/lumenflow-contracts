/* Focus utilities for accessible dialogs. */
(function (global, document) {
  const FOCUSABLE_SELECTOR = [
    'a[href]', 'button:not([disabled])', 'input:not([disabled])',
    'select:not([disabled])', 'textarea:not([disabled])', '[tabindex]:not([tabindex="-1"])'
  ].join(',');

  let previousElement = null;
  let activeDialog = null;

  function getFocusable(dialog) {
    return [...dialog.querySelectorAll(FOCUSABLE_SELECTOR)]
      .filter(element => element.offsetParent !== null);
  }

  function trapFocus(event) {
    if (!activeDialog || event.key !== 'Tab') return;
    const focusable = getFocusable(activeDialog);
    if (!focusable.length) {
      event.preventDefault();
      activeDialog.focus();
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  function activate(dialog, initialFocus) {
    previousElement = document.activeElement;
    activeDialog = dialog;
    document.addEventListener('keydown', trapFocus);
    (initialFocus || getFocusable(dialog)[0] || dialog).focus();
  }

  function deactivate() {
    document.removeEventListener('keydown', trapFocus);
    activeDialog = null;
    if (previousElement && typeof previousElement.focus === 'function') previousElement.focus();
    previousElement = null;
  }

  global.FOCUS_MANAGEMENT_SHORTCUTS = [
    { key: 'Escape', description: 'Close the keyboard shortcuts dialog' },
  ];
  global.FocusManagement = { activate, deactivate };
}(window, document));
