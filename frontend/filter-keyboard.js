/* Keyboard shortcuts for the payment history filters. */
(function (global, document) {
  const shortcuts = [
    { key: '?', description: 'Show keyboard shortcuts' },
    { key: 'f', description: 'Focus the merchant address filter' },
    { key: 'r', description: 'Reset all filters' },
  ];

  function isEditableTarget(target) {
    return target instanceof HTMLElement && (
      ['INPUT', 'SELECT', 'TEXTAREA'].includes(target.tagName) ||
      target.isContentEditable
    );
  }

  function initializeFilterKeyboard({ onHelp, onReset }) {
    document.addEventListener('keydown', event => {
      if (event.key === '?' && !isEditableTarget(event.target)) {
        event.preventDefault();
        onHelp();
        return;
      }
      if (isEditableTarget(event.target)) return;
      if (event.key.toLowerCase() === 'f') {
        event.preventDefault();
        document.getElementById('merchant-address')?.focus();
      } else if (event.key.toLowerCase() === 'r') {
        event.preventDefault();
        onReset();
      }
    });
  }

  global.FILTER_KEYBOARD_SHORTCUTS = shortcuts;
  global.initializeFilterKeyboard = initializeFilterKeyboard;
}(window, document));
